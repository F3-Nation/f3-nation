#!/usr/bin/env bash
# Regression tests for scripts/python-task.sh's turbo cache-flag stripping.
# Run directly: bash scripts/python-task.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_script="${script_dir}/python-task.sh"
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

# Turbo-appended cache suffix (as lint:fix/format:fix/lint emit) is stripped,
# leaving the wrapped command's own flags (e.g. --fix) intact.
actual=$(bash "$task_script" lint label printf '[%s]' --fix --cache --cache-location node_modules/.cache/.eslintcache)
assert_eq "strips trailing turbo cache suffix, keeps --fix" "[--fix]" "$actual"

# A `--` that belongs to the wrapped command (i.e. followed by more of its own
# args, not trailing alone) must survive — this is the case CodeRabbit flagged.
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

if ((failures > 0)); then
  echo "${failures} test(s) failed."
  exit 1
fi

echo "All python-task.sh regression tests passed."
