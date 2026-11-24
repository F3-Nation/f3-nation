#!/usr/bin/env bash
# Regression tests for scripts/wait-for-check-runs.sh. `gh` is replaced by a
# stub that replays one canned response per call (the `name<TAB>status` lines
# the real call's --jq produces), so each case controls what every poll sees.
# Run directly: bash scripts/wait-for-check-runs.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wait_script="${script_dir}/wait-for-check-runs.sh"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wait-for-check-runs-test.XXXXXX")" || exit 1

# Call N prints responses/N, or exits 1 when responses/N.fail exists. A call
# past the last response prints nothing (no check runs).
cat >"$tmp_dir/gh" <<'STUB'
#!/usr/bin/env bash
dir="$(dirname "$0")"
count=$(($(cat "$dir/calls" 2>/dev/null || echo 0) + 1))
echo "$count" >"$dir/calls"
if [[ -e "$dir/responses/$count.fail" ]]; then
  echo "HTTP 502: Bad Gateway" >&2
  exit 1
fi
cat "$dir/responses/$count" 2>/dev/null || true
STUB
chmod +x "$tmp_dir/gh"

# Each argument is one poll's response, with "|" between lines and ":" between
# name and status; FAIL makes that poll's gh call fail.
set_responses() {
  rm -rf "$tmp_dir/responses" "$tmp_dir/calls"
  mkdir "$tmp_dir/responses"
  local i=0 response
  for response in "$@"; do
    i=$((i + 1))
    if [[ "$response" == FAIL ]]; then
      : >"$tmp_dir/responses/$i.fail"
    else
      printf '%s\n' "$response" | tr '|:' '\n\t' >"$tmp_dir/responses/$i"
    fi
  done
}

# Prints "<exit code> calls=<gh calls>: <last output line>".
run_wait() {
  local out code
  out="$(PATH="$tmp_dir:$PATH" GITHUB_REPOSITORY=owner/repo GITHUB_SHA=abc123 bash "$wait_script" "$@" 2>&1)"
  code=$?
  echo "${code} calls=$(cat "$tmp_dir/calls" 2>/dev/null || echo 0): $(printf '%s\n' "$out" | tail -n 1)"
}

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

set_responses "build:completed" "build:completed|lint:queued"
assert_eq "exist waits until every named check has a run" \
  "0 calls=2: " "$(run_wait exist 5 0 build lint)"

set_responses "test-coverage:in_progress" "test-coverage:completed"
assert_eq "completed waits while a check is still running" \
  "0 calls=2: " "$(run_wait completed 5 0 test-coverage)"

set_responses "test-coverage:completed"
assert_eq "completed returns on the first poll when the check has finished" \
  "0 calls=1: " "$(run_wait completed 5 0 test-coverage)"

set_responses "test-coverage:queued|test-coverage:completed"
assert_eq "completed accepts a finished run beside a queued rerun" \
  "0 calls=1: " "$(run_wait completed 5 0 test-coverage)"

set_responses "test-coverage-extra:completed"
assert_eq "a check name only counts on an exact match" \
  "1 calls=2: ::error::These checks didn't finish on abc123 within 0 minutes: test-coverage" \
  "$(run_wait completed 2 0 test-coverage)"

set_responses FAIL "build:completed"
assert_eq "a failed gh call fails the wait instead of polling again" \
  "1 calls=1: ::error::Could not read the check runs on abc123." \
  "$(run_wait exist 5 0 build)"

set_responses "build:completed" "build:completed" "build:completed"
assert_eq "exist times out naming the checks that never appeared" \
  "1 calls=3: ::error::CI didn't start these checks on abc123 within 0 minutes: lint typecheck" \
  "$(run_wait exist 3 0 build lint typecheck)"

set_responses "test-coverage:queued" "test-coverage:in_progress"
assert_eq "completed times out when the check never finishes" \
  "1 calls=2: ::error::These checks didn't finish on abc123 within 0 minutes: test-coverage" \
  "$(run_wait completed 2 0 test-coverage)"

set_responses
assert_eq "an unknown mode is a usage error and calls nothing" \
  "2 calls=0: usage: ${wait_script} exist|completed ATTEMPTS INTERVAL_SECONDS CHECK_NAME..." \
  "$(run_wait present 5 0 build)"

set_responses
assert_eq "a non-numeric attempt count is a usage error" \
  "2 calls=0: usage: ${wait_script} exist|completed ATTEMPTS INTERVAL_SECONDS CHECK_NAME..." \
  "$(run_wait exist many 0 build)"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} test(s) failed"
  exit 1
fi
echo "All wait-for-check-runs tests passed"
