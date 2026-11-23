#!/usr/bin/env bash
# Claude Code SessionStart hook. Stdout is added to the agent's context.
# In a worktree: run setup.sh once, then report branch and stack ports.
# In the primary checkout: tell the agent to move into a worktree.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
source scripts/agent/lib.sh

if ! in_linked_worktree; then
  if [ "${PAYPURE_PRIMARY:-}" = "1" ]; then
    echo "[paypure] PAYPURE_PRIMARY=1: the human unlocked the primary checkout for this session."
  else
    cat <<'EOF'
[paypure] This session is in the PRIMARY checkout, which belongs to the human.
Edits, git writes and docker compose here are blocked by the guard hook.
Before changing anything, create your worktree: use the EnterWorktree tool, or
run `scripts/agent/new.sh <short-task-name>` and work in the path it prints.
Reading and answering questions here is fine.
EOF
  fi
  exit 0
fi

if [ ! -f "$(wt_gitdir)/paypure-setup-done" ]; then
  log=$(mktemp)
  if ! bash scripts/agent/setup.sh >"$log" 2>&1; then
    echo "[paypure] scripts/agent/setup.sh FAILED. Output:"
    tail -n 30 "$log"
    echo "Fix it (or re-run setup.sh) before doing anything else."
    rm -f "$log"
    exit 0
  fi
  rm -f "$log"
fi

ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
cat <<EOF
[paypure] Agent worktree $(wt_root)
branch $(git branch --show-current): $ahead ahead / $behind behind origin/main
stack (if you start it with scripts/agent/stack.sh up): client :$(env_get CLIENT_PORT), api :$(env_get API_PORT), db :$(env_get POSTGRES_PORT)
Workflow: AGENTS.md. Gate: scripts/agent/check.sh. Ship: scripts/agent/land.sh.
EOF
