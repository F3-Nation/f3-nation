#!/usr/bin/env bash
# Regression tests for check-filed-plans.sh, run against a fake `gh` that
# answers from fixtures and logs every call, so the tests can assert the script
# never writes to GitHub.
# Run directly: bash .agents/skills/release/scripts/check-filed-plans.test.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "FAIL: check-filed-plans tests need jq, which CI must provide"
    exit 1
  fi
  echo "SKIP: check-filed-plans tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="${script_dir}/check-filed-plans.sh"
failures=0

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

tmp_dir=""
trap 'if [ -n "$tmp_dir" ]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-filed-plans-test.XXXXXX")" || exit 1
mkdir "$tmp_dir/bin" "$tmp_dir/perm" "$tmp_dir/workflows" || exit 1
export ISSUES_FILE="$tmp_dir/issues.json"
export PERM_DIR="$tmp_dir/perm"
export CALL_LOG="$tmp_dir/calls.log"
export GH_REPO="Org/repo"

export LATE_ISSUES_FILE="$tmp_dir/late-issues.json"
export LIST_COUNT="$tmp_dir/list-count"

# Fake gh: `issue list` prints $ISSUES_FILE, or $LATE_ISSUES_FILE from the
# second call on when that file exists (an issue search only finds later);
# `api .../collaborators/<login>/permission` prints $PERM_DIR/<login> or fails
# like a 404 when there is no such file.
cat >"$tmp_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CALL_LOG"
case "$1 $2" in
  "issue list")
    echo x >>"$LIST_COUNT"
    if [ -f "$LATE_ISSUES_FILE" ] && [ "$(wc -l <"$LIST_COUNT")" -gt 1 ]; then
      cat "$LATE_ISSUES_FILE"
    else
      cat "$ISSUES_FILE"
    fi
    ;;
  api*)
    login="${2#repos/Org/repo/collaborators/}"
    login="${login%/permission}"
    [ -f "$PERM_DIR/$login" ] || exit 1
    cat "$PERM_DIR/$login"
    ;;
  *) exit 1 ;;
esac
GH
chmod +x "$tmp_dir/bin/gh"
export PATH="$tmp_dir/bin:$PATH"

# Apps have a deploy-<component>.yml; packages and tailwind-config don't.
for app in map analytics; do
  : >"$tmp_dir/workflows/deploy-${app}.yml"
done
app_facts="$tmp_dir/app-facts.json"
echo '{"components":["map","pkg-ui","analytics"]}' >"$app_facts"
no_app_facts="$tmp_dir/no-app-facts.json"
echo '{"components":["analytics","pkg-db","tailwind-config"]}' >"$no_app_facts"

echo write >"$PERM_DIR/writer"
echo read >"$PERM_DIR/reader"

# issue <number> <title> <author> <body>
issue() {
  jq -n --argjson n "$1" --arg t "$2" --arg a "$3" --arg b "$4" \
    '{number: $n, title: $t, author: {login: $a}, body: $b}'
}
set_issues() {
  printf '%s\n' "$@" | jq -s '.' >"$ISSUES_FILE"
}
run_check() {
  rm -f "$LIST_COUNT"
  bash "$check" --pr 42 --facts "$1" --workflows-dir "$tmp_dir/workflows" --delay 0 "${@:2}" >/dev/null 2>&1
  echo $?
}

bot="app/github-actions"
release_plan="Release plan: Map tweaks to Staging (#42)"
test_plan="Staging test plan: Map tweaks (#42)"

set_issues \
  "$(issue 101 "$test_plan" "$bot" "Report here. It blocks the go/no-go in #102.")" \
  "$(issue 102 "$release_plan" "$bot" "Work through the Staging test plan, #101.")"
assert_eq "linked plans filed by the workflow pass" 0 "$(run_check "$app_facts")"

set_issues "$(issue 102 "$release_plan" "$bot" "Work through the Staging test plan, #101.")"
assert_eq "an app release with no test plan fails" 1 "$(run_check "$app_facts")"

set_issues "$(issue 102 "$release_plan" "$bot" "No app ships.")"
assert_eq "a release of only packages, tooling and Analytics passes on the release plan alone" 0 "$(run_check "$no_app_facts")"

set_issues "$(issue 101 "$test_plan" "$bot" "Report here.")"
assert_eq "a test plan with no release plan fails" 1 "$(run_check "$app_facts")"

set_issues \
  "$(issue 101 "$test_plan" "$bot" "Report here.")" \
  "$(issue 102 "$release_plan" "$bot" "Work through the Staging test plan, #101.")"
assert_eq "a test plan without the release plan's link fails" 1 "$(run_check "$app_facts")"

set_issues \
  "$(issue 101 "$test_plan" "$bot" "It blocks the go/no-go in #102.")" \
  "$(issue 102 "$release_plan" "$bot" "Work through the Staging test plan, #1010.")"
assert_eq "a longer number that starts with the test plan's doesn't count as a link" 1 "$(run_check "$app_facts")"

set_issues \
  "$(issue 101 "$test_plan" "writer" "It blocks the go/no-go in #102.")" \
  "$(issue 102 "$release_plan" "writer" "Work through the Staging test plan, #101.")"
assert_eq "plans opened by a writer pass" 0 "$(run_check "$app_facts")"

set_issues "$(issue 102 "$release_plan" "reader" "No app ships.")"
assert_eq "a release plan opened by a read-only account fails" 1 "$(run_check "$no_app_facts")"

set_issues "$(issue 102 "$release_plan" "stranger" "No app ships.")"
assert_eq "a release plan whose author's access can't be read fails" 1 "$(run_check "$no_app_facts")"

set_issues "$(issue 102 "Release plan: Map tweaks to Production (#42)" "$bot" "No app ships.")"
assert_eq "a Production release plan doesn't count" 1 "$(run_check "$no_app_facts")"

set_issues \
  "$(issue 99 "$test_plan" "reader" "It blocks the go/no-go in #102.")" \
  "$(issue 101 "$test_plan" "$bot" "It blocks the go/no-go in #102.")" \
  "$(issue 102 "$release_plan" "$bot" "Work through the Staging test plan, #101.")"
assert_eq "an untrusted duplicate doesn't hide the trusted pair" 0 "$(run_check "$app_facts")"

set_issues
printf '%s\n' "$(issue 102 "$release_plan" "$bot" "No app ships.")" | jq -s '.' >"$LATE_ISSUES_FILE"
assert_eq "a plan search finds only on a later attempt passes with retries" 0 "$(run_check "$no_app_facts" --attempts 3)"
assert_eq "the same plan fails without retries" 1 "$(run_check "$no_app_facts")"
rm -f "$LATE_ISSUES_FILE"
assert_eq "retries give up with failure when the plan never appears" 1 "$(run_check "$no_app_facts" --attempts 3)"
assert_eq "retries stop at --attempts" 3 "$(wc -l <"$LIST_COUNT" | tr -d ' ')"

assert_eq "a missing --pr is a usage error" 2 "$(bash "$check" --facts "$app_facts" >/dev/null 2>&1; echo $?)"
assert_eq "a non-numeric --pr is a usage error" 2 "$(bash "$check" --pr 4x --facts "$app_facts" >/dev/null 2>&1; echo $?)"
assert_eq "a missing facts file is a usage error" 2 "$(bash "$check" --pr 42 --facts "$tmp_dir/none.json" >/dev/null 2>&1; echo $?)"
assert_eq "zero --attempts is a usage error" 2 "$(run_check "$app_facts" --attempts 0)"

writes="$(grep -cvE '^(issue list|api repos/Org/repo/collaborators/[^ ]+/permission --jq)' "$CALL_LOG")"
assert_eq "every gh call is a read" 0 "$writes"

if [ "$failures" -ne 0 ]; then
  echo "${failures} check-filed-plans test(s) failed"
  exit 1
fi
echo "All check-filed-plans tests passed"
