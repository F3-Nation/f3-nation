#!/usr/bin/env bash
# Regression tests for prt.sh, the pr-local-test sandbox helper. Runs it against a throwaway
# origin/clone with stubbed gh, node, pnpm and docker, and PRT_ROOT pointed at a temp directory,
# so no real PR, Docker daemon or /tmp/pr-local-test state is touched. Covers:
#   - init never writes through a PR-tracked `.env` symlink
#   - load() makes the run's env authoritative over inherited settings, commented template keys
#     included, and update re-applies that for the new commit's templates
#   - update --approved is bound to the scanned commit, and a failed update is retried
#   - setup after a failed update rebuilds the pending revision, and the head returning to the
#     tested commit still repairs it
#   - init claims its run directory atomically, retrying a run-id collision
#   - check_migrations (applied vs journal), kill_group (identity-checked), and serve's port-in-use refusal
# Missing prerequisites (jq, git, python3, lsof or ss) fail the test.
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

# A missing tool fails the test rather than skipping it, so the lint gate can't pass unchecked.
for tool in jq git python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: $tool is required by this test" >&2; exit 1; }
done
command -v lsof >/dev/null 2>&1 || command -v ss >/dev/null 2>&1 || { echo "FAIL: lsof or ss is required by this test" >&2; exit 1; }

tmp_dir=""
listener_pid=""
cleanup() {
  [ -z "$listener_pid" ] || kill "$listener_pid" 2>/dev/null
  [ -z "$tmp_dir" ] || rm -rf "$tmp_dir"
}
trap cleanup EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/prt-test.XXXXXX")" || {
  echo "FAIL: could not create the test directory" >&2
  exit 1
}

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
cp "$script_dir/../../../../scripts/lib/local-ports.sh" "$origin/scripts/lib/local-ports.sh"
echo 24.0.0 >"$origin/.nvmrc"
echo '{"entries":[{},{}]}' >"$origin/packages/db/drizzle/meta/_journal.json"
printf 'DATABASE_HOST=\nEMAIL_SERVER=\n' >"$origin/apps/auth/.env.example"
echo '{"name":"f3-map","scripts":{"dev":"true"}}' >"$origin/apps/map/package.json"
echo 'F3_CHANNEL=local' >"$origin/apps/map/.env.example"
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
[ ! -e "$tmp_dir/pnpm_probe" ] || echo "\${PROBE_KEY-unset}" >>"$tmp_dir/pnpm_probe"
[ ! -e "$tmp_dir/pnpm_fail" ] || { echo "pnpm failed" >&2; exit 1; }
EOF
cat >"$bin/gh" <<EOF
#!/usr/bin/env bash
echo '{"state":"OPEN","headRefOid":"$c1","baseRefName":"main","isCrossRepository":true,"url":"https://example.invalid/pull/1"}'
EOF
cat >"$bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
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

# --- load: deliberate overrides listed in PRT_PASS survive; connection settings can't be passed
pass_out="$(F3_CHANNEL=staging F3_MAP_PORT=1234 PRT_PASS="F3_CHANNEL F3_MAP_PORT" \
  bash -c '. "$1"; load "$2"; echo "${F3_CHANNEL-unset}|$F3_MAP_PORT"' _ "$prt" "$run")"
assert_eq "PRT_PASS keeps an override, even over the run's own .env" "staging|1234" "$pass_out"
pass_out="$(F3_CHANNEL=staging bash -c '. "$1"; load "$2"; echo "${F3_CHANNEL-unset}"' _ "$prt" "$run")"
assert_eq "without PRT_PASS the inherited override is dropped" "unset" "$pass_out"
pass_out="$(PRT_PASS=DATABASE_HOST bash -c '. "$1"; load "$2"' _ "$prt" "$run" 2>&1)"
assert_eq "PRT_PASS refuses a connection setting" "1" "$?"
assert_contains "the refusal names the variable" "DATABASE_HOST is a connection setting" "$pass_out"

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

# --- update: a commit that needs a Node that isn't installed stops before touching the run
echo 99.0.0 >"$origin/.nvmrc"
git -C "$origin" add -A
git -C "$origin" commit -q -m c3
c3="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c3"
out="$(bash "$prt" update "$run" --approved "$c3" 2>&1)"
assert_eq "update stops when the new Node isn't installed" "3" "$?"
assert_contains "it names the missing Node" "NODE_MISSING=99.0.0" "$out"
assert_eq "the worktree stays on the tested commit" "$c2" "$(git -C "$run/wt" rev-parse HEAD)"
assert_eq "tested_sha is unchanged" "$c2" "$(jq -r .tested_sha "$run/state.json")"

# --- update: new template keys reach the generated .env, and the Node version is refreshed
printf 'DATABASE_HOST=localhost\nEMAIL_SERVER=smtp://local' >"$run/wt/apps/auth/.env"
echo 24.0.0 >"$origin/.nvmrc"
printf 'DATABASE_HOST=\nEMAIL_SERVER=\nNEW_KEY=abc\nNEW_URL=http://localhost:3001/x\n' >"$origin/apps/auth/.env.example"
git -C "$origin" add -A
git -C "$origin" commit -q -m c4
c4="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c4"
out="$(bash "$prt" update "$run" --approved "$c4" 2>&1)"
assert_eq "update with a new template key succeeds" "0" "$?"
assert_contains "it reports the added key" "ENV_KEYS_ADDED=apps/auth/.env:NEW_KEY" "$out"
assert_contains "it appends the key without touching existing ones" "EMAIL_SERVER=smtp://local
NEW_KEY=abc" "$(cat "$run/wt/apps/auth/.env")"
assert_eq "a new key's default port is rewritten to this run's" "NEW_URL=http://localhost:$(jq -r .ports.api "$run/state.json")/x" "$(grep '^NEW_URL=' "$run/wt/apps/auth/.env")"
assert_eq "path_prefix is refreshed for the new commit" "$bin:$bin" "$(jq -r .path_prefix "$run/state.json")"

# --- load: a template that only shows a commented-out key still isolates it
echo '# POSTHOG_KEY=' >>"$run/wt/apps/map/.env.example"
env_out="$(POSTHOG_KEY=leak bash -c '. "$1"; load "$2"; echo "${POSTHOG_KEY-unset}"' _ "$prt" "$run")"
assert_eq "load unsets an inherited variable that a template only declares in a comment" "unset" "$env_out"
git -C "$run/wt" checkout -q -- apps/map/.env.example

# --- update: variables first named by the new commit's templates are cleared before install
echo 'PROBE_KEY=x' >>"$origin/apps/map/.env.example"
git -C "$origin" add -A
git -C "$origin" commit -q -m c5
c5="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c5"
: >"$tmp_dir/pnpm_probe"
out="$(PROBE_KEY=leak bash "$prt" update "$run" --approved "$c5" 2>&1)"
assert_eq "update with an inherited new-template variable succeeds" "0" "$?"
assert_eq "install sees the new template's variable unset" "unset" "$(sort -u "$tmp_dir/pnpm_probe")"
rm "$tmp_dir/pnpm_probe"

# --- update: the head returning to the tested commit repairs a failed update
echo '{"entries":[{},{},{}]}' >"$origin/packages/db/drizzle/meta/_journal.json"
git -C "$origin" add -A
git -C "$origin" commit -q -m c6
c6="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c6"
touch "$tmp_dir/pnpm_fail"
out="$(bash "$prt" update "$run" --approved "$c6" 2>&1)"
assert_eq "an update that fails during install exits 1" "1" "$?"
rm "$tmp_dir/pnpm_fail"
git -C "$origin" update-ref refs/pull/1/head "$c5"
out="$(bash "$prt" update "$run" --approved "$c5" 2>&1)"
assert_eq "update after the head returns to the tested commit succeeds" "0" "$?"
assert_eq "it is not reported as nothing to do" "no" "$([[ "$out" == *NO_NEW_COMMITS* ]] && echo yes || echo no)"
assert_eq "the checkout moves back to the tested commit" "$c5" "$(git -C "$run/wt" rev-parse HEAD)"
assert_eq "the pending revision is cleared" "none" "$(jq -r '.update_pending // "none"' "$run/state.json")"
assert_eq "the run is ready again" "ready" "$(jq -r .phase "$run/state.json")"
assert_contains "the abandoned commit's migrations are flagged for a rebuild" "the abandoned update to $c6 may have migrated the database" "$out"

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
started="$(bash -c '. "$1"; proc_start "$2"' _ "$prt" "$pgid")"
out="$(bash -c '. "$1"; kill_group "$2" "Mon Jan  1 00:00:00 2001"' _ "$prt" "$pgid" 2>&1)"
assert_eq "kill_group spares a group whose leader doesn't match the saved start time" "1" "$(kill -0 -- "-$pgid" 2>/dev/null && echo 1 || echo 0)"
assert_contains "the skipped group is reported" "SKIPPED process group $pgid" "$out"
bash -c '. "$1"; kill_group "$2"' _ "$prt" "$pgid" 2>/dev/null
assert_eq "kill_group spares a group with no saved start time" "1" "$(kill -0 -- "-$pgid" 2>/dev/null && echo 1 || echo 0)"
bash -c '. "$1"; kill_group "$2" "$3"' _ "$prt" "$pgid" "$started"
assert_eq "kill_group ends the process group" "0" "$(kill -0 -- "-$pgid" 2>/dev/null && echo 1 || echo 0)"
bash -c '. "$1"; kill_group "$2" "$3"' _ "$prt" "$pgid" "$started"
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
state_tmp="$(mktemp "$run/.state.XXXXXX")" || {
  echo "FAIL: could not create the state temporary file" >&2
  exit 1
}
jq --argjson p "$busy_port" '.ports.map = $p' "$run/state.json" >"$state_tmp"
mv "$state_tmp" "$run/state.json"
out="$(bash "$prt" serve "$run" map 2>&1)"
assert_eq "serve on a busy port fails" "1" "$?"
assert_contains "serve names the busy port" "port $busy_port is already in use" "$out"

# --- setup: after a failed update, down-db then setup rebuilds the pending revision
git -C "$origin" commit -q --allow-empty -m c7
c7="$(git -C "$origin" rev-parse HEAD)"
git -C "$origin" update-ref refs/pull/1/head "$c7"
touch "$tmp_dir/pnpm_fail"
bash "$prt" update "$run" --approved "$c7" >/dev/null 2>&1
rm "$tmp_dir/pnpm_fail"
assert_eq "a second failed update records its pending revision" "$c7" "$(jq -r .update_pending "$run/state.json")"
echo 3 >"$tmp_dir/applied"
out="$(bash "$prt" setup "$run" 2>&1)"
assert_eq "setup rebuilds the pending revision" "0" "$?"
assert_eq "the rebuilt revision becomes the tested commit" "$c7" "$(jq -r .tested_sha "$run/state.json")"
assert_eq "setup clears the pending revision" "none" "$(jq -r '.update_pending // "none"' "$run/state.json")"
assert_eq "setup leaves the run ready" "ready" "$(jq -r .phase "$run/state.json")"
out="$(bash "$prt" update "$run" --approved "$c7" 2>&1)"
assert_contains "a completed rebuild leaves nothing to update" "NO_NEW_COMMITS" "$out"

# --- init: a run-id collision retries instead of reusing another run's directory
git -C "$origin" update-ref refs/pull/1/head "$c7"
mkdir -p "$PRT_ROOT/pr1-aaaa"
echo keep >"$PRT_ROOT/pr1-aaaa/sentinel"
printf 'aaaa\nbbbb\n' >"$tmp_dir/suffixes"
cat >"$bin/openssl" <<EOF
#!/usr/bin/env bash
head -n1 "$tmp_dir/suffixes"
sed -i.bak 1d "$tmp_dir/suffixes"
EOF
chmod +x "$bin/openssl"
out="$(cd "$tmp_dir/main" && bash "$prt" init 1 2>&1)"
assert_eq "init succeeds despite a colliding run id" "0" "$?"
assert_contains "init takes the next suffix" "RUN_DIR=$PRT_ROOT/pr1-bbbb" "$out"
assert_eq "the colliding run is untouched" "keep" "$(cat "$PRT_ROOT/pr1-aaaa/sentinel")"
rm "$bin/openssl"

if [ "$failures" -ne 0 ]; then
  echo "${failures} assertion(s) failed"
  exit 1
fi
echo "All prt.sh tests passed"
