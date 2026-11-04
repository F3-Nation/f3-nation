#!/usr/bin/env bash
# Exercise local setup's container boundary without starting services or using URLs.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root=""
trap 'if [[ -n "$test_root" ]]; then rm -rf "$test_root"; fi' EXIT
test_root="$(mktemp -d "${TMPDIR:-/tmp}/local-setup-test.XXXXXX")"

mkdir -p "$test_root/bin"
cat >"$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == info || "$1" == compose ]]; then exit 0; fi
if [[ "$1" == exec && "$3" == pg_isready ]]; then exit 0; fi
if [[ "$*" != "exec -i $EXPECTED_CONTAINER psql -U f3local -d f3nation -v ON_ERROR_STOP=1" ]]; then
  echo "FAIL: local database initialization did not use the expected container/stdin boundary" >&2
  exit 73
fi
cat >"$CASE_ROOT/received.sql"
[[ "${SETUP_SQL_FAIL:-0}" == 0 ]]
MOCK
cat >"$test_root/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf '200'
MOCK
cat >"$test_root/bin/pnpm" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CASE_ROOT/pnpm.log"
MOCK
chmod +x "$test_root/bin/"*

run_case() {
  local name="$1" slot="$2" expected_container="$3" failure="$4"
  local case_root="$test_root/$name"
  mkdir -p "$case_root/scripts/lib" "$case_root/scripts/docker"
  cp "$script_dir/local-setup.sh" "$case_root/scripts/local-setup.sh"
  cp "$script_dir/lib/local-ports.sh" "$case_root/scripts/lib/local-ports.sh"
  # A fixed SQL payload isolates stdin routing from database initialization.
  printf 'select 456;\n' >"$case_root/scripts/docker/init-db.sql"
  for dir in apps/api apps/auth apps/map apps/me apps/admin apps/homepage apps/region-pages apps/slackbot packages/env packages/db; do
    mkdir -p "$case_root/$dir"
    printf 'DATABASE_URL=postgresql://f3local:f3local@localhost:5433/f3nation\n' >"$case_root/$dir/.env.example"
  done
  : >"$case_root/pnpm.log"
  local status=0
  (
    cd "$case_root"
    export PATH="$test_root/bin:$PATH" CASE_ROOT="$case_root"
    export EXPECTED_CONTAINER="$expected_container" SETUP_SQL_FAIL="$failure"
    bash scripts/local-setup.sh --slot "$slot"
  ) >"$case_root/output.log" 2>&1 || status=$?
  if [[ "$failure" == 0 ]]; then
    if [[ "$status" != 0 ]]; then cat "$case_root/output.log"; exit 1; fi
    printf 'db:migrate:local\ndb:seed:local\n' >"$case_root/expected-pnpm.log"
    cmp "$case_root/expected-pnpm.log" "$case_root/pnpm.log"
  else
    [[ "$status" != 0 && ! -s "$case_root/pnpm.log" ]] || {
      echo "FAIL: failed database initialization must stop migration and seed"; exit 1;
    }
  fi
  cmp "$case_root/scripts/docker/init-db.sql" "$case_root/received.sql"
  echo "PASS: $name"
}

run_case default-container 0 f3-postgres 0
run_case slotted-container 3 f3-wt3-postgres 0
run_case initialization-failure 3 f3-wt3-postgres 1
echo "All local-setup tests passed"
