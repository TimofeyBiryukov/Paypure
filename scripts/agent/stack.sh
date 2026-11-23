#!/usr/bin/env bash
# This worktree's own Docker stack (AGENTS.md § Dev stack). Compose reads the
# worktree's generated .env, so project name, volumes and ports never clash
# with the human's stack or another agent's.
#   scripts/agent/stack.sh up       start postgres, api, client, gotenberg
#   scripts/agent/stack.sh seed     load the demo workspace (admin@example.com)
#   scripts/agent/stack.sh urls     print this stack's URLs
#   scripts/agent/stack.sh down     stop it and DELETE its database volume
#   scripts/agent/stack.sh <anything else>   passed to docker compose
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_linked_worktree
cd "$(wt_root)"
grep -qF "$ENV_MARKER" .env 2>/dev/null || die "no generated .env; run scripts/agent/setup.sh"

urls() {
  echo "client  http://localhost:$(env_get CLIENT_PORT)"
  echo "api     http://localhost:$(env_get API_PORT)"
  echo "db      postgresql://paypure:paypure@localhost:$(env_get POSTGRES_PORT)/paypure"
}

cmd="${1:-urls}"
[ $# -gt 0 ] && shift
case "$cmd" in
up)
  docker compose up -d --wait postgres api client gotenberg "$@"
  urls
  ;;
seed) docker compose exec api sh -c "cd api && pnpm cli seed:demo" ;;
urls) urls ;;
down) docker compose down -v --remove-orphans "$@" ;;
*) docker compose "$cmd" "$@" ;;
esac
