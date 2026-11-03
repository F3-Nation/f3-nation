#!/usr/bin/env bash
# Regression tests for load_local_ports in scripts/lib/local-ports.sh: a slot saved
# before a port existed gets that port derived from the slot, even over a value the
# shell inherited, a port the root .env sets is kept, and no root .env leaves every
# port unset.
# Run directly: bash scripts/local-ports.test.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/local-ports-test.XXXXXX")"

# Each case runs in a subshell with no inherited overrides, so cases can't leak into
# each other and the caller's own slot ports don't mask a missing derivation. An
# optional NAME=value third argument is exported first, as if the shell inherited it.
load_in() {
  local root="$1" var="$2" inherited="${3:-}"
  (
    unset COMPOSE_PROJECT_NAME F3_CONTAINER_PREFIX
    while IFS= read -r name; do unset "$name"; done < <(compgen -v | grep -E '^F3_[A-Z_]+_PORT$' || true)
    [[ -z "$inherited" ]] || export "${inherited?}"
    # shellcheck source=lib/local-ports.sh
    . "$script_dir/lib/local-ports.sh"
    LOCAL_PORTS_ROOT="$root"
    load_local_ports
    echo "${!var:-unset}"
  )
}

old_slot="$tmp_dir/old-slot"
mkdir "$old_slot"
printf '%s\n' COMPOSE_PROJECT_NAME=f3-local-wt2 F3_CONTAINER_PREFIX=f3-wt2 \
  F3_MAP_PORT=3200 F3_REGION_PAGES_PORT=3206 >"$old_slot/.env"
assert_eq "older slot .env derives the missing Slackbot port" 3207 "$(load_in "$old_slot" F3_SLACKBOT_PORT)"
assert_eq "older slot .env derives the missing Postgres port" 5633 "$(load_in "$old_slot" F3_POSTGRES_PORT)"
assert_eq "an inherited port doesn't mask the slot's derived port" 3207 \
  "$(load_in "$old_slot" F3_SLACKBOT_PORT F3_SLACKBOT_PORT=3107)"

custom="$tmp_dir/custom"
mkdir "$custom"
printf '%s\n' COMPOSE_PROJECT_NAME=f3-local-wt2 F3_MAP_PORT=4000 >"$custom/.env"
assert_eq "a port the .env sets is kept" 4000 "$(load_in "$custom" F3_MAP_PORT)"

no_env="$tmp_dir/no-env"
mkdir "$no_env"
assert_eq "no root .env leaves the Slackbot port unset" unset "$(load_in "$no_env" F3_SLACKBOT_PORT)"

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} local-ports test(s) failed"
  exit 1
fi
echo "All local-ports tests passed"
