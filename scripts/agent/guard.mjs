#!/usr/bin/env node
// Agent guard (AGENTS.md § Hard rules). One script, two callers:
//   Claude Code PreToolUse (Bash, Edit, Write, MultiEdit, NotebookEdit)
//   Cursor beforeShellExecution
//
// WHY (read this if you were blocked): several agents work on Paypure at once,
// each in its own git worktree. The primary checkout belongs to the human, and
// main only moves through scripts/agent/land.sh. This hook refuses:
//   - in the primary checkout: file edits, git writes, `gh pr checkout`, and
//     `docker compose` (that is the human's stack and database)
//   - anywhere: force pushes, pushes to main, deleting main, --no-verify,
//     and bypassing the hooks with core.hooksPath
// A [guard] denial is policy, not a bug. Work in your worktree instead
// (scripts/agent/new.sh <name>). The human can unlock the primary checkout for
// a whole session by launching the agent with PAYPURE_PRIMARY=1.
//
// Fails open: on any parse or git error it allows.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

const UNLOCK = process.env.PAYPURE_PRIMARY === "1";
// Never let an inherited GIT_DIR (e.g. inside a git hook) answer for another path.
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
);

const GIT_WRITES = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
]);
const STASH_READS = new Set(["list", "show"]);
const BRANCH_WRITE_FLAGS = new Set([
  "-d",
  "-D",
  "--delete",
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "-f",
  "--force",
  "-u",
  "--set-upstream-to",
  "--unset-upstream",
]);
const GIT_OPTS_WITH_VALUE = new Set([
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);
const WRAPPERS = new Set(["env", "command", "exec", "time", "nohup", "sudo"]);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Minimal shell tokenizer: quotes, escapes, and operators split segments.
function segments(command) {
  const segs = [];
  let cur = [];
  let tok = "";
  let has = false;
  let q = null;
  const push = () => {
    if (has) cur.push(tok);
    tok = "";
    has = false;
  };
  const end = () => {
    push();
    if (cur.length) segs.push(cur);
    cur = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < command.length) tok += command[++i];
      else tok += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < command.length) {
      tok += command[++i];
      has = true;
    } else if (c === " " || c === "\t") push();
    else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") end();
    else {
      tok += c;
      has = true;
    }
  }
  end();
  return segs;
}

function stripPrefix(tokens) {
  let i = 0;
  while (i < tokens.length && (ENV_ASSIGN.test(tokens[i]) || WRAPPERS.has(tokens[i]))) i++;
  return tokens.slice(i);
}

const resolve = (base, p) => {
  const x = p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
  return normalize(isAbsolute(x) ? x : join(base, x));
};

function existingDir(p) {
  let d = p;
  while (d && !existsSync(d)) {
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return d;
}

const primaryCache = new Map();
function isPrimary(path) {
  const dir = existingDir(path);
  if (!dir) return false;
  if (primaryCache.has(dir)) return primaryCache.get(dir);
  let res = false;
  try {
    const out = execFileSync(
      "git",
      [
        "-C",
        dir,
        "rev-parse",
        "--path-format=absolute",
        "--git-dir",
        "--git-common-dir",
        "--is-bare-repository",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000, env: GIT_ENV },
    ).split("\n");
    if (out[2]?.trim() !== "true" && out[0] && out[1]) {
      res = realpathSync(out[0].trim()) === realpathSync(out[1].trim());
    }
  } catch {
    res = false;
  }
  primaryCache.set(dir, res);
  return res;
}

function gitProblems(tokens, here) {
  let target = here;
  let i = 1;
  const problems = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "-C" && i + 1 < tokens.length) {
      target = resolve(target, tokens[i + 1]);
      i += 2;
    } else if (t === "-c" && i + 1 < tokens.length) {
      if (/^core\.hookspath=/i.test(tokens[i + 1])) problems.push("overriding core.hooksPath");
      i += 2;
    } else if (GIT_OPTS_WITH_VALUE.has(t)) i += 2;
    else if (t.startsWith("-")) i++;
    else break;
  }
  if (i >= tokens.length) return problems;
  const sub = tokens[i];
  const rest = tokens.slice(i + 1);

  if (rest.includes("--no-verify") || (sub === "commit" && rest.includes("-n")))
    problems.push("--no-verify (hooks are the gate)");
  if (sub === "config" && rest.some((r) => /^core\.hookspath$/i.test(r)) && rest.length > 1)
    problems.push("changing core.hooksPath");

  if (sub === "push") {
    if (rest.some((r) => r === "-f" || r.startsWith("--force") || /^\+/.test(r)))
      problems.push("force push (never rewrite pushed history; merge origin/main instead)");
    const refs = rest.filter((r) => !r.startsWith("-")).slice(1);
    if (
      refs.some((r) => /(^|:)(refs\/heads\/)?(main|master)$/.test(r) || /^:?(main|master)$/.test(r))
    )
      problems.push("pushing to main (main only moves through scripts/agent/land.sh)");
    if (rest.includes("--delete") && refs.some((r) => /^(main|master)$/.test(r)))
      problems.push("deleting main");
  }

  let write = null;
  if (sub === "stash" && STASH_READS.has(rest[0])) write = null;
  else if (GIT_WRITES.has(sub)) write = `git ${sub}`;
  else if (
    sub === "branch" &&
    rest.some((r) => BRANCH_WRITE_FLAGS.has(r) || r.startsWith("--set-upstream-to="))
  )
    write = "git branch " + rest.join(" ");
  if (write && !UNLOCK && isPrimary(target)) problems.push(`${write} in the primary checkout`);
  return problems;
}

function checkCommand(command, cwd) {
  const problems = [];
  let here = cwd;
  for (const seg of segments(command)) {
    const t = stripPrefix(seg);
    if (!t.length) continue;
    const prog = basename(t[0]);
    if ((prog === "cd" || prog === "pushd") && t[1]) here = resolve(here, t[1]);
    else if (prog === "git") problems.push(...gitProblems(t, here));
    else if (prog === "gh" && t[1] === "pr" && t[2] === "checkout" && !UNLOCK && isPrimary(here))
      problems.push("gh pr checkout in the primary checkout");
    else if (!UNLOCK && ((prog === "docker" && t[1] === "compose") || prog === "docker-compose")) {
      const pi = t.findIndex((x) => x === "-p" || x === "--project-name");
      const project =
        pi >= 0 ? t[pi + 1] : t.find((x) => x.startsWith("--project-name="))?.slice(15);
      if (project === "paypure" || (project === undefined && isPrimary(here)))
        problems.push(
          "docker compose on the human's stack (use scripts/agent/stack.sh in your worktree)",
        );
    }
  }
  return problems;
}

function message(problems) {
  return (
    `[guard] Blocked: ${[...new Set(problems)].join("; ")}.\n` +
    "Agents work only in their own worktree (AGENTS.md § Hard rules):\n" +
    "  scripts/agent/new.sh <name>    # creates .claude/worktrees/<name> and sets it up\n" +
    "then cd there (Claude Code: EnterWorktree, or prefix commands with `cd <worktree> &&` " +
    "and edit by absolute path inside it). Land with scripts/agent/land.sh. Do not try to " +
    "work around this hook; if the human wants this action, they will run it themselves."
  );
}

function decide(data) {
  const ti = data.tool_input ?? {};
  const cwd = data.cwd || (data.workspace_roots ?? [])[0] || process.cwd();
  const command = ti.command ?? data.command;
  if (typeof command === "string" && command.trim()) {
    const p = checkCommand(command, String(cwd));
    return p.length ? message(p) : null;
  }
  const file = ti.file_path ?? ti.notebook_path;
  if (typeof file === "string" && !UNLOCK) {
    const abs = resolve(String(cwd), file);
    if (isPrimary(abs)) return message([`editing ${file} in the primary checkout`]);
  }
  return null;
}

let input = "";
process.stdin.on("data", (d) => {
  input += d;
});
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(input || "{}");
  } catch {
    data = {};
  }
  const claude = "tool_input" in data || data.hook_event_name === "PreToolUse";
  let msg = null;
  try {
    msg = decide(data);
  } catch {
    msg = null;
  }
  if (claude) {
    if (msg)
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: msg,
          },
        }),
      );
    return;
  }
  process.stdout.write(
    JSON.stringify(
      msg
        ? {
            permission: "deny",
            user_message: "[guard] blocked; the agent should use its worktree.",
            agent_message: msg,
          }
        : { permission: "allow" },
    ),
  );
});
