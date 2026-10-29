#!/usr/bin/env bash
# Regression tests for scripts/check-security-headers-coverage.mjs: that it
# passes a covered Next app (with a .js, .mjs or .ts config), a static export
# and an app with no Next config, and fails, naming the app, when the
# config-test file is missing or does not call nextSecurityHeaderProblems.
# Run directly: bash scripts/check-security-headers-coverage.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-security-headers-coverage.mjs"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-security-headers-coverage-test.XXXXXX")" || exit 1

# Adds apps/<name> to the fixture repo <dir> with the given Next config file
# and config contents, plus a config test that calls the checker.
add_app() {
  local dir="$1" name="$2" config="$3" contents="$4"
  mkdir -p "$dir/apps/$name/__tests__"
  printf '%s\n' "$contents" >"$dir/apps/$name/$config"
  printf 'await nextSecurityHeaderProblems(config, { frame: "deny" });\n' \
    >"$dir/apps/$name/__tests__/next-config.test.ts"
}

expect() {
  local description="$1" expected_status="$2" dir="$3" pattern="${4:-}"
  local output status
  output="$(cd "$dir" && node "$checker" 2>&1)"
  status=$?
  if [[ "$expected_status" == "pass" && "$status" -ne 0 ]]; then
    echo "FAIL: ${description} (expected pass, got: ${output})"
    failures=$((failures + 1))
  elif [[ "$expected_status" == "fail" && "$status" -eq 0 ]]; then
    echo "FAIL: ${description} (expected a failure)"
    failures=$((failures + 1))
  elif [[ -n "$pattern" && "$output" != *"$pattern"* ]]; then
    echo "FAIL: ${description} (output missing '${pattern}': ${output})"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

ok="$tmp_dir/ok"
add_app "$ok" js next.config.js 'export default { poweredByHeader: false };'
add_app "$ok" mjs next.config.mjs 'export default { poweredByHeader: false };'
add_app "$ok" ts next.config.ts 'export default { poweredByHeader: false };'
mkdir -p "$ok/apps/static" "$ok/apps/python"
printf 'export default { output: "export" };\n' >"$ok/apps/static/next.config.js"
printf 'print("not next")\n' >"$ok/apps/python/main.py"
expect "covered apps, a static export and a non-Next app pass" pass "$ok"

missing="$tmp_dir/missing"
add_app "$missing" web next.config.ts 'export default {};'
rm "$missing/apps/web/__tests__/next-config.test.ts"
expect "app with no config test" fail "$missing" "apps/web"

uncalled="$tmp_dir/uncalled"
add_app "$uncalled" web next.config.js 'export default {};'
printf 'it("renders", () => {});\n' >"$uncalled/apps/web/__tests__/next-config.test.ts"
expect "config test that never calls the checker" fail "$uncalled" "apps/web"

mixed="$tmp_dir/mixed"
add_app "$mixed" good next.config.js 'export default {};'
add_app "$mixed" bad next.config.mjs 'export default {};'
rm "$mixed/apps/bad/__tests__/next-config.test.ts"
expect "only the uncovered app is reported" fail "$mixed" "apps/bad"
output="$(cd "$mixed" && node "$checker" 2>&1)"
if [[ "$output" == *"apps/good"* ]]; then
  echo "FAIL: covered app reported alongside the uncovered one (${output})"
  failures=$((failures + 1))
else
  echo "PASS: covered app not reported alongside the uncovered one"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} check-security-headers-coverage test(s) failed"
  exit 1
fi
echo "All check-security-headers-coverage tests passed"
