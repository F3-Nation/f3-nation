#!/usr/bin/env bash
# Regression tests for scripts/python-task.sh: turbo cache-flag stripping, the
# local skip-when-uv-is-missing branch, and the never-skip-in-CI branch.
# Run directly: bash scripts/python-task.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_script="${script_dir}/python-task.sh"
failures=0

# The stripping cases must not depend on whether the machine running the suite
# actually has uv installed, so they run against a stub uv on PATH. The
# uv-missing cases below run against an empty PATH directory instead (invoked
# via "$BASH" so the restricted PATH cannot break resolving bash itself).
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/python-task-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/with-uv" "$tmp_dir/without-uv"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$tmp_dir/with-uv/uv"
chmod +x "$tmp_dir/with-uv/uv"
export PATH="$tmp_dir/with-uv:$PATH"

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

# Turbo-appended cache suffix (as lint:fix/format:fix/lint emit) is stripped,
# leaving the wrapped command's own flags (e.g. --fix) intact.
actual=$(bash "$task_script" lint label printf '[%s]' --fix --cache --cache-location node_modules/.cache/.eslintcache)
assert_eq "strips trailing turbo cache suffix, keeps --fix" "[--fix]" "$actual"

# A `--` that belongs to the wrapped command (i.e. followed by more of its own
# args, not trailing alone) must survive.
actual=$(bash "$task_script" test label printf '[%s]' -- --my-real-flag)
assert_eq "preserves wrapped command's own -- when not a bare trailing token" "[--][--my-real-flag]" "$actual"

# A bare trailing -- with nothing after it still looks like the turbo suffix
# and is stripped.
actual=$(bash "$task_script" test label printf '[%s]' foo --)
assert_eq "strips a bare trailing --" "[foo]" "$actual"

# --cache-location <path> as two trailing tokens is stripped as a pair,
# leaving the wrapped command with no extra args (printf prints one empty
# substitution).
actual=$(bash "$task_script" test label printf '[%s]' --cache-location some/path)
assert_eq "strips trailing --cache-location <path> pair" "[]" "$actual"

# --cache-location=<path> as a single trailing token is stripped.
actual=$(bash "$task_script" test label printf '[%s]' --cache-location=some/path)
assert_eq "strips trailing --cache-location=<path>" "[]" "$actual"

# Mis-invocation fails closed rather than exiting 0 without running anything.
actual=$(bash "$task_script" test label 2>&1 >/dev/null)
status=$?
assert_eq "missing command exits 2" "2" "$status"
assert_eq "missing command explains itself" "1" "$(grep -c 'ERROR: missing command' <<<"$actual")"

actual=$(bash "$task_script" lint label --cache 2>&1 >/dev/null)
status=$?
assert_eq "command stripped to empty exits 2" "2" "$status"
assert_eq "command stripped to empty explains itself" "1" "$(grep -c 'ERROR: command stripped to empty' <<<"$actual")"

# Without uv, a local run skips cleanly: exit 0, one line, command never runs.
actual=$(CI= PATH="$tmp_dir/without-uv" "$BASH" "$task_script" lint label printf '[%s]' ran)
status=$?
assert_eq "skips with exit 0 when uv is missing locally" "0" "$status"
assert_eq "skip message names the task and package" "Skipping lint for label:" "$(cut -d' ' -f1-4 <<<"$actual")"
assert_eq "skipped run never executes the command" "1" "$(grep -c '^Skipping' <<<"$actual")"

# In CI the same situation must fail loudly instead of skipping.
actual=$(CI=true PATH="$tmp_dir/without-uv" "$BASH" "$task_script" lint label printf '[%s]' ran 2>&1 >/dev/null)
status=$?
assert_eq "fails when uv is missing and CI is set" "1" "$status"
assert_eq "CI failure explains the refusal" "1" "$(grep -c 'refusing to skip' <<<"$actual")"

if ((failures > 0)); then
  echo "${failures} test(s) failed."
  exit 1
fi

echo "All python-task.sh regression tests passed."
