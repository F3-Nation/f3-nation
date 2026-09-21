#!/usr/bin/env bash
# Only synthetic fixtures; never use an existing database or override the URL.
set -euo pipefail
cd "$(dirname "$0")/.."
container_name="f3-submission-repair-test-$$"
started=false
cleanup() {
  if [ "$started" = true ]; then
    docker stop "$container_name" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A name/port conflict fails instead of stopping another developer's container.
docker run --rm -d --name "$container_name" \
  -p 127.0.0.1:55435:5432 \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=f3_pr825_test postgres:18.6 >/dev/null
started=true
ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
  if docker exec "$container_name" pg_isready -U postgres -d f3_pr825_test >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "Disposable PostgreSQL database did not become ready" >&2
  exit 1
fi
pnpm exec tsx maintenance/repair-submission-ids.test.ts
