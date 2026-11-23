#!/usr/bin/env bash
# Regression tests for find-release-pr.sh, run against a fake `gh` that answers
# from fixtures and logs every call, so the tests can assert the script never
# writes to GitHub.
# Run directly: bash .agents/skills/release/scripts/find-release-pr.test.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "FAIL: find-release-pr tests need jq, which CI must provide"
    exit 1
  fi
  echo "SKIP: find-release-pr tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
find_pr="${script_dir}/find-release-pr.sh"
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
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/find-release-pr-test.XXXXXX")" || exit 1
mkdir "$tmp_dir/bin" "$tmp_dir/compare" || exit 1
export PAGES_FILE="$tmp_dir/pages.json"
export COMPARE_DIR="$tmp_dir/compare"
export CALL_LOG="$tmp_dir/calls.log"
export GH_REPO="Org/repo"

# Fake gh: the pulls listing prints $PAGES_FILE; `api .../compare/<base>...<head>`
# prints $COMPARE_DIR/<head>, or fails like a 404 when there is no such file.
cat >"$tmp_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CALL_LOG"
case "$*" in
  "api --paginate --slurp repos/Org/repo/pulls?"*) cat "$PAGES_FILE" ;;
  "api repos/Org/repo/compare/"*)
    head="${2##*...}"
    [ -f "$COMPARE_DIR/$head" ] || exit 1
    cat "$COMPARE_DIR/$head"
    ;;
  *) exit 1 ;;
esac
GH
chmod +x "$tmp_dir/bin/gh"
export PATH="$tmp_dir/bin:$PATH"

sha() { printf '%040d' "$1"; }
# pr <number> <merged_at or null> <author> <title> <merge sha seed>
pr() {
  jq -n --argjson n "$1" --argjson m "$2" --arg a "$3" --arg t "$4" --arg s "$(sha "$5")" \
    '{number: $n, merged_at: $m, user: {login: $a}, title: $t, merge_commit_sha: $s}'
}
bot="f3-nation-release-please[bot]"
title="chore: release main"

# Two pages, out of merge order; the newest merge is #30 on the second page.
jq -n --argjson a "$(pr 20 '"2026-01-02T00:00:00Z"' "$bot" "$title" 20)" \
  --argjson b "$(pr 25 null "$bot" "$title" 25)" \
  --argjson c "$(pr 30 '"2026-03-01T00:00:00Z"' "$bot" "$title" 30)" \
  --argjson d "$(pr 31 '"2026-04-01T00:00:00Z"' "someone" "$title" 31)" \
  --argjson e "$(pr 32 '"2026-05-01T00:00:00Z"' "$bot" "chore: something else" 32)" \
  '[[$a, $b], [$c, $d, $e]]' >"$PAGES_FILE"

echo identical >"$COMPARE_DIR/$(sha 30)"
echo ahead >"$COMPARE_DIR/$(sha 40)"
echo behind >"$COMPARE_DIR/$(sha 10)"
echo diverged >"$COMPARE_DIR/$(sha 11)"

run() {
  bash "$find_pr" "$@" 2>/dev/null
  echo "exit=$?"
}

assert_eq "no SHA picks the newest merged release PR across pages" "30 exit=0" "$(run | tr '\n' ' ' | sed 's/ $//')"
assert_eq "the release PR's own merge commit is accepted" "30 exit=0" "$(run --merge-sha "$(sha 30)" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "a commit after the merge commit is accepted" "30 exit=0" "$(run --merge-sha "$(sha 40)" | tr '\n' ' ' | sed 's/ $//')"
assert_eq "a commit before the merge commit fails" "exit=1" "$(run --merge-sha "$(sha 10)")"
assert_eq "a commit that diverged from the merge commit fails" "exit=1" "$(run --merge-sha "$(sha 11)")"
assert_eq "a commit GitHub can't compare fails" "exit=1" "$(run --merge-sha "$(sha 99)")"
assert_eq "a short SHA is a usage error" "exit=2" "$(run --merge-sha abc)"
assert_eq "an uppercase SHA is a usage error" "exit=2" "$(run --merge-sha "$(sha 30 | tr 0 A)")"

echo '[[]]' >"$PAGES_FILE"
assert_eq "no merged release PR fails" "exit=1" "$(run)"

writes="$(grep -cvE '^api (--paginate --slurp repos/Org/repo/pulls\?|repos/Org/repo/compare/)' "$CALL_LOG")"
assert_eq "every gh call is a read" 0 "$writes"

if [ "$failures" -ne 0 ]; then
  echo "${failures} find-release-pr test(s) failed"
  exit 1
fi
echo "All find-release-pr tests passed"
