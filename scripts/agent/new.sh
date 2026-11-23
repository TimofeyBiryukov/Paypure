#!/usr/bin/env bash
# Create a worktree for one agent task and set it up.
#   scripts/agent/new.sh <name>      → .claude/worktrees/<name> on branch agent/<name>
# Claude Code users can instead run `claude -w <name>`; its SessionStart hook
# runs setup.sh. Prints the worktree path on stdout as the last line.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

name="${1:-}"
[[ "$name" =~ ^[a-z0-9][a-z0-9._-]*$ ]] ||
  die "usage: scripts/agent/new.sh <name>   (lowercase, digits, . _ -)"

root=$(primary_root)
path="$root/.claude/worktrees/$name"
branch="agent/$name"

[ -e "$path" ] && die "$path already exists"
git -C "$root" fetch -q origin main
if git -C "$root" show-ref -q --verify "refs/heads/$branch"; then
  die "branch $branch already exists; pick another name"
fi
git -C "$root" worktree add -q --no-track -b "$branch" "$path" origin/main
say "worktree $path on $branch"
(cd "$path" && bash scripts/agent/setup.sh)
echo "$path"
