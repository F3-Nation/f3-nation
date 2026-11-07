#!/usr/bin/env bash
# Regression tests for issue-fields.sh against a fake `gh` that answers from
# fixtures and logs every GraphQL request: name-to-ID resolution, that nothing
# is written when any value or issue is unknown, TSV columns staying aligned
# around empty cells, GraphQL `errors` and empty responses failing the run,
# `get` output, untriaged filtering and pagination, and multi-row apply order.
# Run directly: bash .agents/skills/issue-triage/scripts/issue-fields.test.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "FAIL: issue-fields tests need jq, which CI must provide"
    exit 1
  fi
  echo "SKIP: issue-fields tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fields="${script_dir}/issue-fields.sh"
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
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/issue-fields-test.XXXXXX")" || exit 1
mkdir "$tmp_dir/bin" || exit 1
export REQUEST_LOG="$tmp_dir/requests.jsonl"
export FAKE_DIR="$tmp_dir"
export GH_REPO="acme/repo"

jq -n '{data: {organization: {
  issueTypes: {nodes: [
    {id: "T_bug", name: "Bug", isEnabled: true},
    {id: "T_task", name: "Task", isEnabled: true},
    {id: "T_old", name: "Feature", isEnabled: false}
  ]},
  issueFields: {nodes: [
    {__typename: "IssueFieldSingleSelect", id: "F_pri", name: "Priority",
     options: [{id: "P_high", name: "High"}, {id: "P_low", name: "Low"}]},
    {__typename: "IssueFieldSingleSelect", id: "F_eff", name: "Effort",
     options: [{id: "E_med", name: "Medium"}, {id: "E_low", name: "Low"}]},
    {__typename: "IssueFieldMultiSelect", id: "F_app", name: "App",
     options: [{id: "A_map", name: "Map"}, {id: "A_api", name: "API"}, {id: "A_near", name: "Near Me"}]},
    {__typename: "IssueFieldDate", id: "F_date", name: "Target date"}
  ]}
}}}' >"$tmp_dir/catalog.json"

# Issues come in two pages; issue 1's Priority and Effort differ so a swap shows.
jq -n '
  def issue($n; $type; $vals): {number: $n, title: "Issue \($n)", url: "u", author: {login: "a"},
    labels: {nodes: []}, parent: null, subIssuesSummary: {total: 0}, body: "b",
    issueType: (if $type then {name: $type} else null end), issueFieldValues: {nodes: $vals}};
  def sv($f; $v): {name: $v, field: {name: $f}};
  def page($next; $cursor; $nodes): {data: {repository: {issues:
    {pageInfo: {hasNextPage: $next, endCursor: $cursor}, nodes: $nodes}}}};
  page(true; "c1"; [
    issue(1; "Bug"; [sv("Priority"; "High"), sv("Effort"; "Low"), {options: [{name: "Map"}], field: {name: "App"}}]),
    issue(2; null; [])
  ]),
  page(false; null; [issue(3; "Task"; [sv("Priority"; "High"), sv("Effort"; "Low")])])
' | jq -sc '.' >"$tmp_dir/pages.json"

# The fake answers by what the request asks for and logs every request. Like
# real gh, it exits 1 when it returns an `errors` body. Flag files in FAKE_DIR:
# fail-lookup (lookups error), missing-<n> (issue n doesn't exist),
# fail-mutation-<id> (field writes to that issue error), empty-response
# (mutations return nothing), stuck-cursor (every page after the first repeats
# the first page's cursor and says more pages follow).
cat >"$tmp_dir/bin/gh" <<'FAKE'
#!/usr/bin/env bash
body=$(cat)
printf '%s\n' "$body" | jq -c . >>"$REQUEST_LOG"
query=$(printf '%s' "$body" | jq -r .query)
var() { printf '%s' "$body" | jq -r ".variables.$1"; }
case "$query" in
  *organization*) cat "$FAKE_DIR/catalog.json" ;;
  *"issues(first"*)
    # A loop that never advances its cursor fails here instead of hanging.
    if [ "$(grep -c 'issues(first' "$REQUEST_LOG")" -gt 5 ]; then
      echo "fake gh: too many issue-list requests" >&2
      exit 1
    fi
    if [ "$(var c)" = null ]; then
      jq -c '.[0]' "$FAKE_DIR/pages.json"
    elif [ -f "$FAKE_DIR/stuck-cursor" ]; then
      jq -c '.[0]' "$FAKE_DIR/pages.json"
    else
      jq -c '.[1]' "$FAKE_DIR/pages.json"
    fi ;;
  *"issue(number:\$n){ number"*)
    jq -c --argjson n "$(var n)" \
      '{data: {repository: {issue: ([.[].data.repository.issues.nodes[] | select(.number == $n)][0])}}}' \
      "$FAKE_DIR/pages.json" ;;
  *"issue(number:\$n){ id }"*)
    if [ -f "$FAKE_DIR/fail-lookup" ]; then
      echo '{"data":null,"errors":[{"message":"Could not resolve"}]}'
      exit 1
    elif [ -f "$FAKE_DIR/missing-$(var n)" ]; then
      echo '{"data":{"repository":{"issue":null}}}'
    else
      printf '{"data":{"repository":{"issue":{"id":"I_%s"}}}}\n' "$(var n)"
    fi ;;
  *mutation*)
    if [ -f "$FAKE_DIR/empty-response" ]; then
      exit 0
    elif [[ "$query" == *setIssueFieldValue* ]] && [ -f "$FAKE_DIR/fail-mutation-$(var i)" ]; then
      echo '{"data":null,"errors":[{"message":"Field write refused"}]}'
      exit 1
    fi
    echo '{"data":{}}' ;;
  *) echo "fake gh: unexpected query: $query" >&2; exit 1 ;;
esac
FAKE
chmod +x "$tmp_dir/bin/gh" || {
  echo "FAIL: cannot make the fake gh executable"
  exit 1
}
export PATH="$tmp_dir/bin:$PATH"

reset_log() { : >"$REQUEST_LOG"; }
mutations() { jq -c 'select(.query | startswith("mutation")) | .variables' "$REQUEST_LOG"; }
contains() { printf '%s' "$2" | grep -cF -- "$1" | tr -d ' '; }

# options: disabled types hidden, multi-select marked, non-triage fields left out.
assert_eq "options lists enabled types and the three triage fields" \
  "Type: Bug, Task
Priority: High, Low
Effort: Medium, Low
App (multiple): Map, API, Near Me" \
  "$(bash "$fields" options)"

# set: names match case-insensitively and become the option IDs.
reset_log
bash "$fields" set 7 --type bug --priority HIGH --effort " low " --app "near me, map" >/dev/null 2>&1
assert_eq "set sends the type ID" '{"i":"I_7","t":"T_bug"}' "$(mutations | sed -n 1p)"
assert_eq "set sends every field by ID, App as a sorted unique ID list" \
  '{"i":"I_7","f":[{"fieldId":"F_pri","singleSelectOptionId":"P_high"},{"fieldId":"F_eff","singleSelectOptionId":"E_low"},{"fieldId":"F_app","multiSelectOptionIds":["A_map","A_near"]}]}' \
  "$(mutations | sed -n 2p)"

# set: a disabled type or unknown option fails before any write.
reset_log
out=$(bash "$fields" set 7 --type Feature 2>&1)
assert_eq "a disabled issue type is rejected" "1" "$?"
assert_eq "the rejection names the valid types" \
  'issue-fields: issue 7: unknown Type "Feature"; choose one of: Bug, Task' "$out"
bash "$fields" set 7 --priority Low --app "Map,Mars" >/dev/null 2>&1
assert_eq "an unknown App option is rejected" "1" "$?"
assert_eq "nothing is written when a value is unknown" "" "$(mutations)"

# set with only a field leaves the type alone.
reset_log
bash "$fields" set 8 --effort Medium >/dev/null 2>&1
assert_eq "set without --type sends no type mutation" "1" "$(mutations | wc -l | tr -d ' ')"

# An App value of only commas and spaces counts as empty, not as "clear App".
reset_log
bash "$fields" set 8 --effort Medium --app " , " >/dev/null 2>&1
assert_eq "an all-comma App is left out of the write" \
  '{"i":"I_8","f":[{"fieldId":"F_eff","singleSelectOptionId":"E_med"}]}' "$(mutations)"
reset_log
out=$(bash "$fields" set 8 --app "," 2>&1)
assert_eq "an all-comma App alone fails" "1" "$?"
assert_eq "the all-comma App failure says nothing to set" "1" "$(contains 'issue 8: nothing to set' "$out")"
assert_eq "an all-comma App alone writes nothing" "" "$(mutations)"

# apply: empty cells keep later columns in place, and extra columns are ignored.
reset_log
printf '# number\ttype\tpriority\teffort\tapp\ttitle\treason\n9\t\t\tMedium\t\tSome title\tOne PR\n' >"$tmp_dir/one.tsv"
bash "$fields" apply "$tmp_dir/one.tsv" >/dev/null 2>&1
assert_eq "an effort-only row sets only Effort" \
  '{"i":"I_9","f":[{"fieldId":"F_eff","singleSelectOptionId":"E_med"}]}' "$(mutations)"

# apply: one bad row blocks every row, and each bad row is reported.
reset_log
printf '10\tBug\tLow\tLow\tMap\n11\tTask\tUrgent\tLow\tMap\n12\t\t\t\t\n' >"$tmp_dir/bad.tsv"
out=$(bash "$fields" apply "$tmp_dir/bad.tsv" 2>&1)
assert_eq "apply fails when any row is invalid" "1" "$?"
assert_eq "apply writes nothing when any row is invalid" "" "$(mutations)"
assert_eq "apply reports the unknown option row" "1" "$(printf '%s' "$out" | grep -c 'line 2: issue 11: unknown Priority "Urgent"')"
assert_eq "apply reports the empty row" "1" "$(printf '%s' "$out" | grep -c 'line 3: issue 12: nothing to set')"

# apply: a row whose number isn't a number is reported with its reason.
reset_log
printf 'abc\tBug\n' >"$tmp_dir/nan.tsv"
out=$(bash "$fields" apply "$tmp_dir/nan.tsv" 2>&1)
assert_eq "apply fails on a non-numeric issue number" "1" "$?"
assert_eq "apply reports why the number is bad" "1" "$(contains "line 1: issue 'abc': not an issue number" "$out")"
assert_eq "a non-numeric issue number writes nothing" "" "$(mutations)"

# apply: an issue that doesn't exist stops the run before any write.
reset_log
touch "$tmp_dir/missing-21"
printf '20\t\t\tLow\n21\t\t\tLow\n22\t\t\tLow\n' >"$tmp_dir/missing.tsv"
out=$(bash "$fields" apply "$tmp_dir/missing.tsv" 2>&1)
assert_eq "apply fails when an issue is missing" "1" "$?"
assert_eq "a missing issue writes nothing, even for earlier rows" "" "$(mutations)"
assert_eq "the missing issue is named" "1" "$(contains 'issue 21 not found in acme/repo' "$out")"
rm "$tmp_dir/missing-21"

# apply: rows are written in file order.
reset_log
printf '30\t\t\tLow\n31\tTask\t\tLow\n32\t\t\tLow\n' >"$tmp_dir/three.tsv"
bash "$fields" apply "$tmp_dir/three.tsv" >/dev/null 2>&1
assert_eq "apply writes every row in file order" "I_30 I_31 I_31 I_32" "$(mutations | jq -r .i | tr '\n' ' ' | sed 's/ $//')"

# apply: a field write that fails after the Type was set stops the run there.
reset_log
touch "$tmp_dir/fail-mutation-I_31"
out=$(bash "$fields" apply "$tmp_dir/three.tsv" 2>&1)
assert_eq "a failed write fails apply" "1" "$?"
assert_eq "rows after the failed write are not written" "I_30 I_31 I_31" "$(mutations | jq -r .i | tr '\n' ' ' | sed 's/ $//')"
assert_eq "the row before the failure is reported as set" "1" "$(contains 'set #30' "$out")"
assert_eq "the failing issue is named before its write" "1" "$(contains 'setting #31' "$out")"
assert_eq "the failing write's GraphQL error is reported" "1" "$(contains 'GraphQL error: Field write refused' "$out")"
rm "$tmp_dir/fail-mutation-I_31"

# A GraphQL `errors` entry fails the run and its message is reported.
touch "$tmp_dir/fail-lookup"
out=$(bash "$fields" set 13 --priority Low 2>&1)
assert_eq "a GraphQL error fails the run" "1" "$?"
assert_eq "the GraphQL error message is reported" "1" "$(contains 'GraphQL error: Could not resolve' "$out")"
assert_eq "a failed lookup is not reported as a missing issue" "0" "$(contains 'not found in' "$out")"
rm "$tmp_dir/fail-lookup"

# An empty response is a failure, not a successful write.
touch "$tmp_dir/empty-response"
out=$(bash "$fields" set 14 --priority Low 2>&1)
assert_eq "an empty GraphQL response fails the run" "1" "$?"
assert_eq "the empty response is reported" "1" "$(contains 'GraphQL response has no data' "$out")"
assert_eq "an empty response is not reported as set" "0" "$(contains 'set #14' "$out")"
rm "$tmp_dir/empty-response"

# get: the projected values come from the matching fields.
assert_eq "get prints the issue's Type, Priority, Effort and App" \
  '{"type":"Bug","priority":"High","effort":"Low","app":["Map"]}' \
  "$(bash "$fields" get 1 | jq -c '{type,priority,effort,app}')"

# untriaged: only issues missing a type or any triage field, across pages.
reset_log
assert_eq "untriaged skips fully triaged issues on every page" "2
3" "$(bash "$fields" untriaged | jq -r .number)"
assert_eq "untriaged requests each page once" "2" "$(grep -c 'issues(first' "$REQUEST_LOG")"

# untriaged: a page that says more follow but repeats the cursor fails at once.
reset_log
touch "$tmp_dir/stuck-cursor"
stuck_err=$(bash "$fields" untriaged 2>&1 >/dev/null)
stuck_status=$?
rm -f "$tmp_dir/stuck-cursor"
assert_eq "untriaged fails when the cursor doesn't advance" "1" "$stuck_status"
assert_eq "untriaged names the stuck cursor" "1" "$(contains "pagination did not advance (endCursor 'c1')" "$stuck_err")"
assert_eq "untriaged stops after the repeated page" "2" "$(grep -c 'issues(first' "$REQUEST_LOG")"

if [ "$failures" -gt 0 ]; then
  echo "${failures} issue-fields test(s) failed"
  exit 1
fi
echo "All issue-fields tests passed"
