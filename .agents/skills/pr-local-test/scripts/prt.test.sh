#!/usr/bin/env bash
# Regression tests for prt.sh, the pr-local-test sandbox helper. Runs it against a throwaway
# origin/clone with stubbed gh, node, pnpm and docker, and PRT_ROOT pointed at a temp directory,
# so no real PR, Docker daemon or /tmp/pr-local-test state is touched. Covers:
#   - init never writes through a PR-tracked `.env` symlink
#   - load() makes the run's env authoritative over inherited connection settings
#   - update --approved is bound to the scanned commit, and a failed update is retried
#   - check_migrations (applied vs journal), kill_group, and serve's port-in-use refusal
# Run directly: bash .agents/skills/pr-local-test/scripts/prt.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prt="$script_dir/prt.sh"
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

assert_contains() {
  local description="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL: ${description}"
    echo "  expected to contain: ${needle}"
    echo "  actual:              ${haystack}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

for tool in jq git python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP: $tool not installed"; exit 0; }
done
command -v lsof >/dev/null 2>&1 || command -v ss >/dev/null 2>&1 || { echo "SKIP: neither lsof nor ss installed"; exit 0; }

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/prt-test.XXXXXX")"
listener_pid=""
cleanup() {
  [ -z "$listener_pid" ] || kill "$listener_pid" 2>/dev/null
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export PRT_ROOT="$tmp_dir/root"

# --- a PR whose tree tracks `.env` as a symlink to a file outside the sandbox
victim="$tmp_dir/victim"
echo untouched >"$victim"
origin="$tmp_dir/origin"
git init -q "$origin"
git -C "$origin" symbolic-ref HEAD refs/heads/main
mkdir -p "$origin/scripts/lib" "$origin/packages/db/drizzle/meta" "$origin/apps/auth" "$origin/apps/map"
echo ':' >"$origin/scripts/lib/local-ports.sh"
echo 24.0.0 >"$origin/.nvmrc"
echo '{"entries":[{},{}]}' >"$origin/packages/db/drizzle/meta/_journal.json"
printf 'DATABASE_HOST=\nEMAIL_SERVER=\n' >"$origin/apps/auth/.env.example"
echo '{"name":"f3-map","scripts":{"dev":"true"}}' >"$origin/apps/map/package.json"
ln -s "$victim" "$origin/.env"
git -C "$origin" add -A
git -C "$origin" commit -q -m c1
c1="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c1"
git clone -q "$origin" "$tmp_dir/main"

# --- stubs
bin="$tmp_dir/bin"
mkdir "$bin"
cat >"$bin/node" <<'EOF'
#!/usr/bin/env bash
echo v24.0.0
EOF
cat >"$bin/pnpm" <<EOF
#!/usr/bin/env bash
[ ! -e "$tmp_dir/pnpm_fail" ] || { echo "pnpm failed" >&2; exit 1; }
EOF
cat >"$bin/gh" <<EOF
#!/usr/bin/env bash
echo '{"state":"OPEN","headRefOid":"$c1","baseRefName":"main","isCrossRepository":true,"url":"https://example.invalid/pull/1"}'
EOF
cat >"$bin/docker" <<EOF
#!/usr/bin/env bash
case "\$1" in
  ps) echo cid ;;
  exec) case "\$*" in *"select count"*) cat "$tmp_dir/applied" ;; *) echo __drizzle_migrations ;; esac ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$bin"/*
export PATH="$bin:$PATH"

# --- init: the checked-out `.env` symlink must not be written through
init_out="$(cd "$tmp_dir/main" && bash "$prt" init 1 2>&1)"
assert_eq "init succeeds" "0" "$?"
run="$(printf '%s\n' "$init_out" | sed -n 's/^RUN_DIR=//p')"
assert_eq "init leaves the symlink target untouched" "untouched" "$(cat "$victim")"
assert_eq "init replaces a tracked .env symlink with a regular file" "no" "$([ -L "$run/wt/.env" ] && echo yes || echo no)"
assert_contains "init writes the run's own .env" "COMPOSE_PROJECT_NAME=prt-" "$(cat "$run/wt/.env")"

# --- load: inherited connection settings must not leak into the run
env_out="$(DATABASE_HOST=remote EMAIL_SERVER=smtp://remote DATABASE_URL=postgres://remote KEEP_ME=1 \
  bash -c '. "$1"; load "$2"; echo "${DATABASE_HOST-unset}|${EMAIL_SERVER-unset}|${DATABASE_URL-unset}|${KEEP_ME-unset}|${F3_MAP_PORT-unset}"' _ "$prt" "$run")"
map_port="$(jq -r .ports.map "$run/state.json")"
assert_eq "load unsets inherited split DB/SMTP/URL settings and keeps unrelated vars" \
  "unset|unset|unset|1|$map_port" "$env_out"

# --- update: approval is bound to the scanned commit
echo change >"$origin/README"
git -C "$origin" add -A
git -C "$origin" commit -q -m c2
c2="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c2"

out="$(bash "$prt" update "$run" 2>&1)"
assert_eq "fork update without approval exits 6" "6" "$?"
assert_contains "NEEDS_APPROVAL names the sha to approve" "update --approved $c2" "$out"

out="$(bash "$prt" update "$run" --approved "$c1" 2>&1)"
assert_eq "approval of a stale sha exits 6" "6" "$?"
assert_contains "stale approval asks again for the new head" "NEEDS_APPROVAL $c1 -> $c2" "$out"

# --- update: a failed install keeps the run incomplete so the retry repeats it
touch "$tmp_dir/pnpm_fail"
out="$(bash "$prt" update "$run" --approved "$c2" 2>&1)"
assert_eq "update fails when install fails" "1" "$?"
assert_eq "failed update does not advance tested_sha" "$c1" "$(jq -r .tested_sha "$run/state.json")"
assert_eq "failed update records the pending revision" "$c2" "$(jq -r .update_pending "$run/state.json")"
assert_eq "failed update marks the phase incomplete" "update_incomplete" "$(jq -r .phase "$run/state.json")"

rm "$tmp_dir/pnpm_fail"
out="$(bash "$prt" update "$run" --approved "$c2" 2>&1)"
assert_eq "same-head retry repeats the preparation and succeeds" "0" "$?"
assert_contains "retry reports the update" "UPDATED $c1 -> $c2" "$out"
assert_eq "successful retry advances tested_sha" "$c2" "$(jq -r .tested_sha "$run/state.json")"
assert_eq "successful retry clears the pending revision" "none" "$(jq -r '.update_pending // "none"' "$run/state.json")"
out="$(bash "$prt" update "$run" 2>&1)"
assert_contains "a further update at the same head is a no-op" "NO_NEW_COMMITS" "$out"

# --- check_migrations: applied rows must match the journal
log="$tmp_dir/migrate.log"
echo "migrator output" >"$log"
echo 1 >"$tmp_dir/applied"
out="$(bash -c '. "$1"; load "$2"; check_migrations pr "$3"' _ "$prt" "$run" "$log" 2>&1)"
assert_eq "fewer applied migrations than the journal fails" "1" "$?"
assert_contains "mismatch reports applied vs journal" "1 applied, journal has 2" "$out"
echo 2 >"$tmp_dir/applied"
out="$(bash -c '. "$1"; load "$2"; check_migrations pr "$3"' _ "$prt" "$run" "$log" 2>&1)"
assert_eq "matching migration count passes" "0" "$?"
assert_contains "match reports the count" "MIGRATED(pr)=2/2" "$out"

# --- kill_group: terminates a process group, and tolerates one that is already gone
pgid="$(bash -c 'set -m; sleep 300 >/dev/null 2>&1 & echo $!')"
bash -c '. "$1"; kill_group "$2"' _ "$prt" "$pgid"
assert_eq "kill_group ends the process group" "0" "$(kill -0 -- "-$pgid" 2>/dev/null && echo 1 || echo 0)"
bash -c '. "$1"; kill_group "$2"' _ "$prt" "$pgid"
assert_eq "kill_group on a dead group succeeds" "0" "$?"

# --- serve: refuses a port that is already taken
busy_port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -c 'import socket, sys, time
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1])))
s.listen()
time.sleep(60)' "$busy_port" &
listener_pid=$!
sleep 1
state_tmp="$(mktemp "$run/.state.XXXXXX")"
jq --argjson p "$busy_port" '.ports.map = $p' "$run/state.json" >"$state_tmp"
mv "$state_tmp" "$run/state.json"
out="$(bash "$prt" serve "$run" map 2>&1)"
assert_eq "serve on a busy port fails" "1" "$?"
assert_contains "serve names the busy port" "port $busy_port is already in use" "$out"

if [ "$failures" -ne 0 ]; then
  echo "${failures} assertion(s) failed"
  exit 1
fi
echo "All prt.sh tests passed"
