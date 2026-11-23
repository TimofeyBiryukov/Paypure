#!/usr/bin/env bash
# Human-side cleanup (run from the primary checkout). For every agent worktree
# whose branch has a merged or closed PR: stop its stack (deleting its DB
# volume), remove the worktree, delete the local branch.
#   scripts/agent/prune.sh          dry run: list what would go
#   scripts/agent/prune.sh --yes    do it
#   scripts/agent/prune.sh --list   show every worktree, its PR and stack
set -euo pipefail
source "$(dirname "$0")/lib.sh"

mode="${1:-dry}"
root=$(primary_root)

git -C "$root" fetch -q --prune origin
git -C "$root" worktree prune

git -C "$root" worktree list --porcelain | awk '
  /^worktree /{p=substr($0,10)} /^branch /{print p "\t" substr($0,19)}' |
  while IFS=$'\t' read -r path branch; do
    [ "$path" = "$root" ] && continue
    info=$(gh pr list --head "$branch" --state all --limit 1 \
      --json number,state -q '.[0] | "#\(.number) \(.state)"' 2>/dev/null || true)
    project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$path/.env" 2>/dev/null | tail -n1)
    running=""
    [ -n "$project" ] && [ -n "$(docker compose -p "$project" ps -q 2>/dev/null)" ] &&
      running=" stack:up"
    dirty=""
    [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ] && dirty=" DIRTY"
    if [ "$mode" = "--list" ]; then
      printf '%-50s %-28s %s%s%s\n' "$path" "$branch" "${info:-no PR}" "$running" "$dirty"
      continue
    fi
    case "$info" in *MERGED | *CLOSED) ;; *) continue ;; esac
    if [ -n "$dirty" ]; then
      warn "skip $path: uncommitted changes ($info)"
      continue
    fi
    if [ "$mode" != "--yes" ]; then
      echo "would remove $path ($branch, $info)"
      continue
    fi
    [ -n "$project" ] && (cd "$path" && docker compose down -v --remove-orphans -t 5 >/dev/null 2>&1 || true)
    git -C "$root" worktree remove "$path"
    git -C "$root" branch -D "$branch" >/dev/null
    say "removed $path ($branch, $info)"
  done
[ "$mode" = "dry" ] && say "dry run; pass --yes to remove" || true
