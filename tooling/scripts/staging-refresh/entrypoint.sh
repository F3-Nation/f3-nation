#!/usr/bin/env bash
# Entrypoint of the f3-staging-refresh Cloud Run job (F3-65, docs/STAGING_REFRESH.md).
#
# 1. Starts a throwaway Postgres 18 inside the container for the obfuscation
#    copy. Its data directory is under /tmp: Cloud Run's filesystem lives in
#    memory, so the job's memory limit must hold the ~6 GB copy plus dumps.
#    Durability settings are off: the copy is thrown away either way.
# 2. Builds the prod/staging URLs from the job's env vars and secrets (Cloud
#    SQL unix sockets from --set-cloudsql-instances), unless full
#    PROD_DATABASE_URL / STAGING_DATABASE_URL are given (local rehearsals).
# 3. Runs the orchestrator with --yes. Extra args are passed through, e.g.
#    gcloud run jobs execute f3-staging-refresh ... --args=--dry-run
set -euo pipefail

STAGING_DB_NAME="${STAGING_DB_NAME:-f3_staging}"
COPY_PORT="${COPY_PORT:-5499}"
PGDATA_DIR="$(mktemp -d /tmp/refresh-pg.XXXXXX)"

cleanup() {
  pg_ctl -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" /tmp/refresh-pg.log
}
trap cleanup EXIT

echo "== starting the throwaway Postgres for the copy"
initdb -D "$PGDATA_DIR" -U postgres -A trust --no-sync -E UTF8 --locale=en_US.utf8 >/dev/null
pg_ctl -D "$PGDATA_DIR" -l /tmp/refresh-pg.log -w -t 120 start -o "\
  -c listen_addresses=127.0.0.1 -p $COPY_PORT -c unix_socket_directories=/tmp \
  -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
  -c wal_level=minimal -c max_wal_senders=0 -c autovacuum=off \
  -c shared_buffers=${COPY_SHARED_BUFFERS:-2GB} -c maintenance_work_mem=1GB -c work_mem=64MB \
  -c max_wal_size=4GB -c checkpoint_timeout=30min \
  -c max_parallel_workers_per_gather=0 -c max_parallel_maintenance_workers=0" >/dev/null
createdb -h 127.0.0.1 -p "$COPY_PORT" -U postgres f3_copy
export INTERMEDIATE_DATABASE_URL="postgresql://postgres@127.0.0.1:${COPY_PORT}/f3_copy"

# URL-encode via the environment so a password never lands in argv.
urlenc() { V="$1" node -e 'process.stdout.write(encodeURIComponent(process.env.V))'; }
if [ -z "${PROD_DATABASE_URL:-}" ]; then
  PROD_DATABASE_URL="postgresql://$(urlenc "$PROD_DB_USER"):$(urlenc "$PROD_DB_PASSWORD")@localhost/${PROD_DB_NAME}?host=${PROD_DB_SOCKET}"
fi
if [ -z "${STAGING_DATABASE_URL:-}" ]; then
  STAGING_DATABASE_URL="postgresql://$(urlenc "$STAGING_DB_USER"):$(urlenc "$STAGING_DB_PASSWORD")@localhost/${STAGING_DB_NAME}?host=${STAGING_DB_SOCKET}"
fi
export PROD_DATABASE_URL STAGING_DATABASE_URL
unset PROD_DB_PASSWORD STAGING_DB_PASSWORD
export TMPDIR=/tmp

cd /app/tooling/scripts
status=0
node --import tsx src/staging-refresh.ts --allow-staging-db "$STAGING_DB_NAME" --yes "$@" || status=$?
exit "$status"
