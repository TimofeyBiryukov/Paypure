// node --test scripts/agent/guard.test.mjs  (part of scripts/agent/check.sh)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const GUARD = new URL("./guard.mjs", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "guard-test-"));
const primary = join(tmp, "repo");
const wt = join(primary, ".claude/worktrees/t");
const git = (...a) => execFileSync("git", a, { stdio: "ignore" });
git("init", "-q", "-b", "main", primary);
git(
  "-C",
  primary,
  "-c",
  "user.name=t",
  "-c",
  "user.email=t@t",
  "commit",
  "-q",
  "--allow-empty",
  "-m",
  "i",
);
git("-C", primary, "worktree", "add", "-q", "-b", "agent/t", wt);
after(() => rmSync(tmp, { recursive: true, force: true }));

function run(payload, env = {}) {
  const r = spawnSync("node", [GUARD], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PAYPURE_PRIMARY: "", ...env },
  });
  return r.stdout ? JSON.parse(r.stdout) : null;
}
const bash = (command, cwd, env) =>
  run({ hook_event_name: "PreToolUse", tool_input: { command }, cwd }, env);
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === "deny";

const blockedEverywhere = [
  "git push --force origin agent/t",
  "git push -f",
  "git push --force-with-lease",
  "git push origin +agent/t",
  "git push origin main",
  "git push origin HEAD:main",
  "git push origin HEAD:refs/heads/main",
  "git commit --no-verify -m x",
  "git -c core.hooksPath=/dev/null push",
  "git config core.hooksPath /dev/null",
  "docker compose -p paypure down -v",
];
const allowedInWorktree = [
  "git status",
  "git commit -m 'fix: thing; with semicolon'",
  "git push -u origin HEAD",
  "git merge origin/main",
  "git stash list",
  "docker compose up -d",
  "scripts/agent/land.sh",
  'git commit -m "mention git push origin main in prose"',
];

for (const c of blockedEverywhere)
  test(`blocked in worktree: ${c}`, () => assert.ok(denied(bash(c, wt))));
for (const c of allowedInWorktree)
  test(`allowed in worktree: ${c}`, () => assert.equal(bash(c, wt), null));

for (const c of [
  "git commit -m x",
  "git checkout -b x",
  "git stash",
  "git branch -D x",
  "docker compose down -v",
  "gh pr checkout 3",
])
  test(`blocked in primary: ${c}`, () => assert.ok(denied(bash(c, primary))));
for (const c of [
  "git status",
  "git log",
  "git fetch origin",
  "git worktree add x",
  "git stash list",
  "ls",
])
  test(`allowed in primary: ${c}`, () => assert.equal(bash(c, primary), null));

test("cd into primary is tracked", () =>
  assert.ok(denied(bash(`cd ${primary} && git commit -m x`, wt))));
test("git -C primary is tracked", () =>
  assert.ok(denied(bash(`git -C ${primary} reset --hard`, wt))));
test("cd into worktree is tracked", () =>
  assert.equal(bash(`cd ${wt} && git commit -m x`, primary), null));
test("PAYPURE_PRIMARY=1 unlocks primary", () =>
  assert.equal(bash("git commit -m x", primary, { PAYPURE_PRIMARY: "1" }), null));
test("PAYPURE_PRIMARY=1 does not unlock force push", () =>
  assert.ok(denied(bash("git push -f", primary, { PAYPURE_PRIMARY: "1" }))));
test("command-prefix PAYPURE_PRIMARY=1 does nothing", () =>
  assert.ok(denied(bash("PAYPURE_PRIMARY=1 git commit -m x", primary))));

const edit = (file_path, cwd) =>
  run({
    hook_event_name: "PreToolUse",
    tool_input: { file_path, old_string: "a", new_string: "b" },
    cwd,
  });
test("edit in primary blocked", () => assert.ok(denied(edit(join(primary, "x.ts"), wt))));
test("new file in new dir in primary blocked", () =>
  assert.ok(denied(edit(join(primary, "a/b/c.ts"), primary))));
test("edit in worktree allowed", () => assert.equal(edit(join(wt, "x.ts"), primary), null));
test("edit outside any repo allowed", () =>
  assert.equal(edit(join(tmp, "scratch.txt"), primary), null));

test("cursor protocol", () => {
  assert.equal(run({ command: "git commit -m x", cwd: primary }).permission, "deny");
  assert.equal(run({ command: "git status", cwd: primary }).permission, "allow");
});
test("garbage input fails open", () => {
  const r = spawnSync("node", [GUARD], { input: "not json", encoding: "utf8" });
  assert.equal(r.status, 0);
});
