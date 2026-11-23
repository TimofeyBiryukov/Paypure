# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Start parallel agents with `claude -w <task-name>` (one per task; `--tmux` to
  keep them in panes). The SessionStart hook sets up the worktree and prints
  its branch and stack ports.
- If your session opened in the primary checkout, call `EnterWorktree` before
  you edit anything. The guard hook (`.claude/settings.json` →
  `scripts/agent/guard.mjs`) denies edits, git writes and `docker compose` there.
- Commit on your branch whenever a verified unit of work is done. You don't need
  to ask; that is the standing policy in this repo. Pushing and merging go only
  through `scripts/agent/land.sh`.
- When you finish: report the PR URL and what `land.sh` printed. If you stopped
  short of `MERGED`, say exactly why.
