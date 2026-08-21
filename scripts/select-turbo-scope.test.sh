#!/usr/bin/env bash
# Regression tests for scripts/select-turbo-scope.sh.
# Run directly: bash scripts/select-turbo-scope.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scope_script="${script_dir}/select-turbo-scope.sh"
failures=0
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/turbo-scope-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

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

run_case() {
  local name="$1" turbo_body="$2"
  local case_dir="${tmp_dir}/${name}"
  mkdir -p "$case_dir"
  printf '%s\n' '#!/usr/bin/env bash' "$turbo_body" >"${case_dir}/turbo"
  chmod +x "${case_dir}/turbo"
  : >"${case_dir}/github-env"

  GITHUB_ENV="${case_dir}/github-env" \
    TURBO_SCOPE_TURBO_BIN="${case_dir}/turbo" \
    bash "$scope_script" >"${case_dir}/output" 2>&1
  status=$?
}

run_case affected 'printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\'''
assert_eq "affected selection exits successfully" "0" "$status"
assert_eq "affected selection enables --affected" "TURBO_RUN_ARGS=--affected" "$(cat "${tmp_dir}/affected/github-env")"

run_case empty 'printf '\''%s\n'\'' '\''{"packages":{"count":0}}'\'''
assert_eq "empty selection exits successfully" "0" "$status"
assert_eq "empty selection falls back to full" "TURBO_RUN_ARGS=" "$(cat "${tmp_dir}/empty/github-env")"
assert_eq "empty selection emits a notice" "1" "$(grep -c '::notice::Turbo selected no affected workspaces' "${tmp_dir}/empty/output")"

run_case failure 'exit 17'
assert_eq "Turbo failure exits successfully" "0" "$status"
assert_eq "Turbo failure falls back to full" "TURBO_RUN_ARGS=" "$(cat "${tmp_dir}/failure/github-env")"
assert_eq "Turbo failure emits a warning" "1" "$(grep -c '::warning::Turbo affected-workspace detection failed' "${tmp_dir}/failure/output")"

run_case malformed 'printf '\''%s\n'\'' '\''not-json'\'''
assert_eq "malformed JSON exits successfully" "0" "$status"
assert_eq "malformed JSON falls back to full" "TURBO_RUN_ARGS=" "$(cat "${tmp_dir}/malformed/github-env")"
assert_eq "malformed JSON emits a warning" "1" "$(grep -c '::warning::Turbo returned invalid affected-workspace JSON' "${tmp_dir}/malformed/output")"

if ((failures > 0)); then
  echo "${failures} test(s) failed."
  exit 1
fi

echo "All select-turbo-scope.sh regression tests passed."
