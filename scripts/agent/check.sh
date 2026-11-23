#!/usr/bin/env bash
# The gate (AGENTS.md § Testing). Same steps locally and in CI.
#   scripts/agent/check.sh          lint, typecheck, unit tests, guard tests
#   scripts/agent/check.sh --full   + api and client production builds
# On success with a clean tree it stamps HEAD, which the pre-push hook and
# land.sh accept as "this commit passed". Never edit or fake the stamp.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$(wt_root)"

full=0
for a in "$@"; do
  case "$a" in
  --full) full=1 ;;
  *) die "unknown option: $a" ;;
  esac
done

step() { say "── $*"; }

step "install (frozen lockfile)"
pnpm install --frozen-lockfile --prefer-offline --reporter=silent

step "build @paypure/domain, prisma generate, next typegen"
pnpm --filter @paypure/domain build >/dev/null
DATABASE_URL="${DATABASE_URL:-postgresql://unused@localhost/unused}" \
  pnpm --filter api exec prisma generate >/dev/null
pnpm --filter client exec next typegen >/dev/null

step "biome check (format + lint)"
pnpm exec biome check . --diagnostic-level=error

step "typecheck"
pnpm -r typecheck

step "unit tests"
pnpm -r test

step "agent guard tests"
node --test scripts/agent/guard.test.mjs >/dev/null

if [ "$full" = 1 ]; then
  step "build api"
  pnpm --filter api build
  step "build client"
  pnpm --filter client build
fi

if [ -z "${CI:-}" ]; then
  if [ -z "$(git status --porcelain)" ]; then
    git rev-parse HEAD >"$(wt_gitdir)/paypure-check-ok"
    say "PASS — stamped $(git rev-parse --short HEAD)"
  else
    say "PASS — tree has uncommitted changes, so nothing stamped."
    say "Commit, then re-run before pushing."
  fi
else
  say "PASS"
fi
