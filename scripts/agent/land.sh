#!/usr/bin/env bash
# Ship this worktree's branch to main (AGENTS.md § Landing).
#   scripts/agent/land.sh [--title "..."] [--body-file path]
# Loop: merge origin/main → gate → push → PR → wait for CI → squash-merge.
# Branch protection requires the PR to be up to date with main, so when
# another agent lands first, the loop merges main again and repeats.
# Exit codes: 0 merged, 2 merge conflict (resolve, commit, re-run),
# 3 gate or CI failed (fix, commit, re-run), 1 anything else.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_linked_worktree
cd "$(wt_root)"

title="" body_file=""
while [ $# -gt 0 ]; do
  case "$1" in
  --title) title="$2"; shift 2 ;;
  --body-file) body_file="$2"; shift 2 ;;
  *) die "unknown option: $1" ;;
  esac
done

branch=$(git branch --show-current)
[ -n "$branch" ] || die "detached HEAD; check out your task branch"
case "$branch" in main | master) die "refusing to land from $branch" ;; esac
[ -z "$(git status --porcelain)" ] ||
  die "uncommitted changes. Commit them (or remove them) first:
$(git status --short)"

for attempt in 1 2 3 4 5 6; do
  say "── attempt $attempt: sync with origin/main"
  git fetch -q origin main
  if ! git merge-base --is-ancestor origin/main HEAD; then
    if ! git merge --no-edit origin/main; then
      die "MERGE CONFLICT with origin/main in:
$(git diff --name-only --diff-filter=U)
Resolve per AGENTS.md § Conflicts, then: git add -A; git commit --no-edit;
scripts/agent/land.sh" 2
    fi
  fi

  head=$(git rev-parse HEAD)
  if [ "$(cat "$(wt_gitdir)/paypure-check-ok" 2>/dev/null)" != "$head" ]; then
    bash scripts/agent/check.sh || die "GATE FAILED. Fix, commit, re-run land.sh" 3
  else
    say "gate already passed for ${head:0:7}"
  fi

  git push -q -u origin HEAD

  pr=$(gh pr view --json number,state -q 'select(.state=="OPEN") | .number' 2>/dev/null || true)
  if [ -z "$pr" ]; then
    args=(--base main --head "$branch")
    if [ -n "$title" ]; then args+=(--title "$title"); else args+=(--fill-first); fi
    if [ -n "$body_file" ]; then
      args+=(--body-file "$body_file")
    elif [ -n "$title" ]; then
      args+=(--body "")
    fi
    gh pr create "${args[@]}" >/dev/null
    pr=$(gh pr view --json number -q .number)
    say "opened PR #$pr"
  else
    gh pr ready "$pr" >/dev/null 2>&1 || true
  fi

  say "waiting for CI on #$pr (${head:0:7})"
  for _ in $(seq 1 24); do # checks take a few seconds to register after a push
    out=$(gh pr checks "$pr" 2>&1) && break
    case "$out" in *"no checks reported"*) sleep 5 ;; *) break ;; esac
  done
  if ! gh pr checks "$pr" --watch --fail-fast --interval 15 >/dev/null; then
    gh pr checks "$pr" || true
    die "CI FAILED on #$pr. Read the log: gh run view --log-failed
Fix, commit, re-run land.sh" 3
  fi

  state=$(gh pr view "$pr" --json mergeStateStatus -q .mergeStateStatus)
  case "$state" in
  BEHIND | DIRTY)
    say "main moved while CI ran ($state); syncing again"
    continue
    ;;
  esac

  if gh pr merge "$pr" --squash --match-head-commit "$head" 2>&1; then
    say "MERGED #$pr into main"
    say "Next: scripts/agent/stack.sh down (if you started it), then leave the"
    say "worktree; the human prunes it with scripts/agent/prune.sh"
    exit 0
  fi
  warn "merge refused; re-checking"
  sleep 5
done
die "gave up after 6 attempts; main is moving too fast or something is wrong. Ask the human."
