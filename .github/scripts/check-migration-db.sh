#!/usr/bin/env bash
# Independent synthetic migration databases; never reuse the compose/shared test database.
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd -- "$repo_root"
migration_container=''
cleanup() {
  local result=$?
  if [[ -n "$migration_container" ]]; then
    local marker
    marker=$(docker inspect --format '{{ index .Config.Labels "weiban.fixture" }}' "$migration_container" 2>/dev/null || true)
    if [[ "$marker" == 'migration-ci-1109' ]]; then
      docker rm -f "$migration_container" >/dev/null
    else
      printf '%s\n' 'Migration container identity changed; cleanup refused' >&2
      result=1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Docker refuses an occupied loopback port; it cannot silently attach to an existing database.
migration_container=$(docker run --rm -d --label weiban.fixture=migration-ci-1109 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:56389:5432 \
  pgvector/pgvector:0.8.7-pg18-bookworm)
[[ "$migration_container" =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' 'Invalid fixture container ID' >&2; exit 1; }
ready=false
for _ in {1..30}; do
  if docker exec "$migration_container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { printf '%s\n' 'Migration fixture did not become ready' >&2; exit 1; }

for database in codex_migration_chat_ci codex_migration_relations_ci \
  codex_migration_group_memory_1109 codex_migration_favorite_sources_ci \
  codex_migration_preferences_1109 codex_migration_preservation_1109 \
  codex_migration_deletion_review_ci codex_migration_execution_1109; do
  docker exec "$migration_container" createdb -U postgres "$database"
done
docker exec "$migration_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d codex_migration_execution_1109 \
  -c "CREATE TABLE public.codex_migration_fixture(id text PRIMARY KEY,synthetic boolean NOT NULL); INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true);" >/dev/null
export TSX_TSCONFIG_PATH=apps/server/tsconfig.json
export MIGRATION_LAB_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_chat_ci
export MIGRATION_RELATIONS_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_relations_ci
export MIGRATION_GROUP_MEMORY_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_group_memory_1109
export MIGRATION_FAVORITE_SOURCES_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_favorite_sources_ci
export MIGRATION_PREFERENCES_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_preferences_1109
export MIGRATION_PRESERVATION_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_preservation_1109
export MIGRATION_DELETION_REVIEW_DATABASE_URL=postgres://postgres@127.0.0.1:56389/codex_migration_deletion_review_ci
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 \
  scripts/ops/legacy-delta-db.test.mjs scripts/ops/legacy-delta-relations.test.mjs \
  scripts/ops/legacy-delta-group-memory.test.mjs scripts/ops/legacy-delta-favorite-sources.test.mjs \
  scripts/ops/legacy-delta-preferences.test.mjs scripts/ops/legacy-migration-preservation-domains.test.mjs \
  scripts/ops/legacy-deletion-readonly-db.test.mjs scripts/ops/legacy-media-readonly-db.test.mjs scripts/ops/legacy-deletion-memory-review.test.mjs scripts/ops/migration-execution-ledger.test.mjs \
  scripts/ops/chat-execution-handler.test.mjs
