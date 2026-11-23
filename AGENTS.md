# AGENTS.md

Rules for every coding agent working on Paypure (Claude Code, Codex, Cursor, …).
`CLAUDE.md` and `.cursor/rules/agents.mdc` point here; this file wins on conflict.
What Paypure is and how it is laid out: `README.md`. The product and design
specs live in `docs/paypure/`, and they decide product questions.

Several agents work on this repo at the same time. The workflow below is how
they avoid stepping on each other. It is **not optional**, and hooks enforce
most of it.

## Workflow: one task = one worktree = one branch = one PR

```
new worktree ─► work + commit ─► scripts/agent/check.sh ─► scripts/agent/land.sh ─► done
 (off origin/main)  (tests with code)  (the gate)            (sync, PR, CI, merge)
```

1. **Start in your own worktree.** Each worktree is a separate checkout with its own
   branch, files, `node_modules`, ports and database. Pick one:
   - Claude Code: `claude -w <task-name>` (add `--tmux` to run several side by side).
     If you are already in a session in the primary checkout, use the
     `EnterWorktree` tool before changing anything.
   - Anything else: `scripts/agent/new.sh <task-name>`, then work in the path it prints
     (`.claude/worktrees/<task-name>`, branch `agent/<task-name>`).
   - Cursor: a worktree agent. `.cursor/worktrees.json` runs setup.

   Setup (`scripts/agent/setup.sh`) runs automatically for `new.sh`, Claude Code
   (SessionStart hook) and Cursor. Run it yourself after `git worktree add` by hand,
   or whenever `pnpm-lock.yaml` changes. It is idempotent.
2. **Claim the work before you sink time in.** Run `gh pr list` first. If an open
   PR already covers your area, stop and tell the human instead of duplicating it.
   For anything bigger than about an hour, push early and open a draft PR
   (`gh pr create --draft`) so other agents can see what you are doing.
3. **Stay in scope.** Touch only what the task needs. No drive-by reformatting,
   renames or "while I'm here" refactors: they cause most merge conflicts between
   agents. If you find something else worth doing, mention it in your PR body.
4. **Commit often, on your branch.** Small commits with real messages. Never commit
   `.env`, secrets or anything under `data/`.
5. **Land with `scripts/agent/land.sh`** (details below). Your task is not done
   until it reports `MERGED`. If it stops, fix what it reports and run it again.
6. **Afterwards:** `scripts/agent/stack.sh down` if you started a stack. Leave the
   worktree in place. The human removes merged worktrees with `scripts/agent/prune.sh`.

## Testing: the gate

`scripts/agent/check.sh` is the gate. It runs on every push (pre-push hook), in
`land.sh`, and in CI (`.github/workflows/ci.yml`, with `--full`):

| Step          | Command                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| deps          | `pnpm install --frozen-lockfile` (a stale lockfile fails here)                                  |
| codegen       | build `@paypure/domain`, `prisma generate`                                                      |
| format + lint | `biome check .` (errors fail; warnings don't)                                                   |
| types         | `pnpm -r typecheck`                                                                             |
| unit tests    | `pnpm -r test` (vitest)                                                                         |
| `--full` / CI | `nest build` and `next build`                                                                   |
| CI only       | fresh Postgres 18 → app role → `prisma migrate deploy` → `schema.prisma` matches the migrations |

Rules:

- **Behaviour changes ship with tests.** Domain logic (`packages/domain`) gets
  vitest cases next to the existing ones in `domain.test.ts`. Use the worked
  examples from the docs where they exist. API and client logic that can be
  tested without a server gets a `*.test.ts` beside it (vitest is already set up
  in `api` and `client`). If something genuinely can't be unit-tested, say how
  you verified it in the PR body.
- **UI and API flows:** verify them in your own stack (`scripts/agent/stack.sh up`,
  then `seed`), then say in the PR what you clicked through.
- **Never weaken the gate** to get green: no deleting or `.skip`-ing tests, no
  loosening assertions, no `biome-ignore`, `@ts-expect-error`, `any` casts or rule
  downgrades to hide a real problem. No `--no-verify`, no editing the check stamp.
  If a test is wrong, fix the test and explain why in the commit message.
- Run `biome check --write .` to auto-format before committing.
- Existing lint debt is downgraded to `warn` in `biome.json`. Don't add new
  violations of those rules. Fixing them and setting a rule back to `error` is
  welcome, as its own PR.

## Landing: `scripts/agent/land.sh`

Agents merge their own work. `land.sh` does it safely:

1. refuses if the tree has uncommitted changes
2. `git fetch` + `git merge origin/main` into your branch (a **merge, not a rebase**:
   pushed history is never rewritten)
3. runs the gate (skipped if this exact commit already passed)
4. pushes, and opens the PR if there isn't one (`--title "…" --body-file f` to set
   them, otherwise it uses your first commit). Marks a draft PR ready.
5. waits for CI (`check`), then squash-merges with `--match-head-commit`

`main` is protected: no direct pushes, CI must pass, and the PR must be up to date
with `main`. If another agent lands while your CI is running, your PR falls behind,
and `land.sh` loops back to step 2 by itself. Landings happen one at a time, and
nothing reaches `main` without passing CI against the latest `main`.

Exit codes: `0` merged · `2` merge conflict · `3` gate or CI failed · `1` other.
For `3` on CI, read the log (`gh run view --log-failed`), fix, commit, and re-run.

Write a PR body that a reviewer can use: what changed, why, how you tested it, and
anything you were unsure about. The human reviews merged PRs after the fact.

## Conflicts

When `land.sh` exits `2`, the merge is in progress in your worktree:

1. `git diff --name-only --diff-filter=U` lists the files. Read **both** sides and
   `git log origin/main -- <file>` to see what the other change was for.
2. Keep both intents. Their change is already on `main` and already reviewed, so
   adapt your change to it. Never drop it, and don't take `--ours`/`--theirs`
   wholesale on source files.
3. Special cases:
   - `pnpm-lock.yaml`: `git checkout --theirs pnpm-lock.yaml && pnpm install`.
     This regenerates the lockfile from both sides' `package.json`.
   - **Prisma migrations:** never edit a migration that is on `main`. If `main`
     gained a migration that sorts after yours, rename your folder to a fresh
     timestamp (`date -u +%Y%m%d%H%M%S`) so it applies last. Then re-check
     `schema.prisma`: both sides' models must be in it.
   - Generated files (`api/src/generated`, `dist`): never resolve by hand. Regenerate
     them by running `scripts/agent/setup.sh`.
4. `git add -A && git commit --no-edit`, then `scripts/agent/check.sh` and
   `scripts/agent/land.sh` again.
5. If the two changes truly contradict each other (both redesign the same thing),
   stop, `git merge --abort`, and ask the human.

## Dev stack (per worktree)

`setup.sh` writes a gitignored `.env` in your worktree with your own
`COMPOSE_PROJECT_NAME` (`paypure-wt-<name>`) and a port block `20000 + slot*10`
(client `+0`, api `+1`, postgres `+2`, debug `+3/+4`, mailpit `+5`, adminer `+6`).
Each worktree therefore gets its own containers, its own database volume and its
own migrations.

```bash
scripts/agent/stack.sh up      # postgres, api (runs migrations), client, gotenberg
scripts/agent/stack.sh seed    # demo workspace: admin@example.com / paypure-demo
scripts/agent/stack.sh urls
scripts/agent/stack.sh logs -f api
scripts/agent/stack.sh down    # stop and DELETE this stack's database
```

Host-side commands (`pnpm …`, `check.sh`) don't need the stack. Start it only
when you need to run the app. Each stack uses about 3 GB of RAM, so take it
down when you're done. The human's stack (project `paypure`, ports 3000/4000/5432)
is off limits.

## Hard rules (enforced by `scripts/agent/guard.mjs` + `.githooks/pre-push`)

1. **The primary checkout belongs to the human.** In it, agents may read but
   never edit files, run git writes (commit, checkout, merge, stash, reset, …)
   or run `docker compose`. Work in your worktree.
2. **`main` moves only through `land.sh`.** No `git push` to main, no force-push
   anywhere (`--force`, `--force-with-lease`, `+ref`), no deleting `main`.
3. **No bypassing:** no `--no-verify`, no `core.hooksPath` changes, no faking the
   check stamp, no editing `.claude/settings.json`, `.cursor/hooks.json` or
   `scripts/agent/*` to unblock yourself. Changing them is only allowed when the
   task is about this setup itself.
4. **Shared stash.** All worktrees share one stash stack. Use a WIP commit
   instead of `git stash`.
5. **Don't touch other agents' worktrees, branches or stacks.**
6. **Stop and ask** if a hook blocks something you think the task needs. Don't
   look for a way around it.

The human can unlock the primary checkout for a whole session by launching the
agent with `PAYPURE_PRIMARY=1` (for example `PAYPURE_PRIMARY=1 claude`). Agents
never set this themselves.

## Project conventions

- **Real HTML forms.** Every data commit in `client` is a native `<form>` with a
  Server Action. No onClick/onKeyDown "pseudo forms" (Guide §7).
- Money is integer minor units through `@paypure/domain`. Never use floats for amounts.
- Invariants Prisma can't express (immutability triggers, exclusion constraints)
  live in hand-written SQL in `api/prisma/migrations`. Keep them when you change
  the schema.
- The app connects as `paypure_app` (not the table owner). Migrations run as `paypure`.
