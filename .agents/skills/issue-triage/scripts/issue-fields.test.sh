#!/usr/bin/env bash
# Regression tests for issue-fields.sh against a fake `gh` that answers from
# fixtures and logs every GraphQL request: name-to-ID resolution, that nothing
# is written when any value is unknown, TSV columns staying aligned around
# empty cells, GraphQL `errors` failing the run, and the untriaged filter.
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
mkdir "$tmp_dir/bin"
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

jq -n '
  def issue($n; $type; $vals): {number: $n, title: "Issue \($n)", url: "u", author: {login: "a"},
    labels: {nodes: []}, parent: null, subIssuesSummary: {total: 0}, body: "b",
    issueType: (if $type then {name: $type} else null end), issueFieldValues: {nodes: $vals}};
  def sv($f; $v): {name: $v, field: {name: $f}};
  {data: {repository: {issues: {pageInfo: {hasNextPage: false, endCursor: null}, nodes: [
    issue(1; "Bug"; [sv("Priority"; "Low"), sv("Effort"; "Low"), {options: [{name: "Map"}], field: {name: "App"}}]),
    issue(2; null; []),
    issue(3; "Task"; [sv("Priority"; "High"), sv("Effort"; "Low")])
  ]}}}}' >"$tmp_dir/issues.json"

# The fake answers by what the request asks for; mutations and lookups are logged.
cat >"$tmp_dir/bin/gh" <<'FAKE'
#!/usr/bin/env bash
body=$(cat)
printf '%s\n' "$body" | jq -c . >>"$REQUEST_LOG"
query=$(printf '%s' "$body" | jq -r .query)
case "$query" in
  *organization*) cat "$FAKE_DIR/catalog.json" ;;
  *"issues(first"*) cat "$FAKE_DIR/issues.json" ;;
  *"issue(number:\$n){ id }"*)
    if [ -f "$FAKE_DIR/fail-lookup" ]; then
      echo '{"data":null,"errors":[{"message":"Could not resolve"}]}'
    else
      printf '{"data":{"repository":{"issue":{"id":"I_%s"}}}}\n' "$(printf '%s' "$body" | jq -r .variables.n)"
    fi ;;
  *mutation*) echo '{"data":{}}' ;;
  *) echo "fake gh: unexpected query: $query" >&2; exit 1 ;;
esac
FAKE
chmod +x "$tmp_dir/bin/gh"
export PATH="$tmp_dir/bin:$PATH"

reset_log() { : >"$REQUEST_LOG"; }
mutations() { jq -c 'select(.query | startswith("mutation")) | .variables' "$REQUEST_LOG"; }

# options: disabled types hidden, multi-select marked, non-triage fields left out.
assert_eq "options lists enabled types and the three triage fields" \
  "Type: Bug, Task
Priority: High, Low
Effort: Medium, Low
App (multiple): Map, API, Near Me" \
  "$(bash "$fields" options)"

# set: names match case-insensitively and become the option IDs.
reset_log
bash "$fields" set 7 --type bug --priority HIGH --effort " low " --app "near me, map" >/dev/null
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
bash "$fields" set 8 --effort Medium >/dev/null
assert_eq "set without --type sends no type mutation" "1" "$(mutations | wc -l | tr -d ' ')"

# apply: empty cells keep later columns in place, and extra columns are ignored.
reset_log
printf '# number\ttype\tpriority\teffort\tapp\ttitle\treason\n9\t\t\tMedium\t\tSome title\tOne PR\n' >"$tmp_dir/one.tsv"
bash "$fields" apply "$tmp_dir/one.tsv" >/dev/null
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

# A GraphQL `errors` entry fails the run even though gh exits 0.
touch "$tmp_dir/fail-lookup"
bash "$fields" set 13 --priority Low >/dev/null 2>&1
assert_eq "a GraphQL error fails the run" "1" "$?"
rm "$tmp_dir/fail-lookup"

# untriaged: only issues missing a type or any triage field.
assert_eq "untriaged skips fully triaged issues" "2
3" "$(bash "$fields" untriaged | jq -r .number)"

if [ "$failures" -gt 0 ]; then
  echo "${failures} issue-fields test(s) failed"
  exit 1
fi
echo "All issue-fields tests passed"
