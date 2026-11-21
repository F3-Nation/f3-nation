#!/usr/bin/env bash
# Regression tests for scripts/my-work.sh, run against synthetic PR and issue fixtures and a fake gh.
# Run directly: bash scripts/my-work.test.sh
set -uo pipefail

# my-work needs jq. `pnpm lint` runs this for everyone, so a local run without jq skips; in
# CI a missing jq fails, so lint can't pass without running these tests.
if ! command -v jq >/dev/null 2>&1; then
  if [[ -n "${CI:-}" ]]; then
    echo "FAIL: my-work tests need jq, which isn't installed" >&2
    exit 1
  fi
  echo "SKIP: my-work tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
my_work="${script_dir}/my-work.sh"
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

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/my-work-test.XXXXXX")" || exit 1

mkdir "$tmp_dir/no-tools"
missing_jq=$(CI=true PATH="$tmp_dir/no-tools" "$BASH" "${BASH_SOURCE[0]}" 2>&1)
assert_eq "in CI, a missing jq fails instead of skipping" \
  "1|FAIL: my-work tests need jq, which isn't installed" "$?|$missing_jq"

printf '*  @andy @viewer\n' >"$tmp_dir/CODEOWNERS"
printf '*  @andy\n' >"$tmp_dir/CODEOWNERS-without-viewer"

# Every PR defaults to: ready, opened long ago, no skill runs, no threads, checks passing.
jq -n '
  def pr($n; $author): {
    number: $n, title: "PR \($n)", url: "https://github.com/acme/repo/pull/\($n)",
    isDraft: false, createdAt: "2026-10-01T00:00:00Z", reviewDecision: null, mergeable: "MERGEABLE",
    author: {login: $author}, assignees: {nodes: []},
    timelineItems: {nodes: []},
    commits: {nodes: [{commit: {oid: "head", committedDate: "2026-10-01T00:00:00Z",
      statusCheckRollup: {state: "SUCCESS"}}}]},
    comments: {nodes: []}, reviews: {nodes: []}, reviewThreads: {nodes: []}
  };
  def review($body; $comments): {author: {login: "andy"}, submittedAt: "2026-10-22T00:00:00Z",
    body: $body, commit: {oid: "head"},
    comments: {nodes: ($comments | map({author: {login: "andy"}, body: ., replyTo: null}))}};
  def inline: .reviews.nodes += [review(""; ["Fix this.\n<!-- pr-review-inline -->\n_written by Model_"])];
  def both: inline | .reviews.nodes += [review("| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; [])];
  def assign($who): .assignees.nodes = [$who[] | {login: .}];
  def thread($by; $last): {isResolved: false, comments: {nodes: [{author: {login: $by}}]},
    lastComment: {nodes: [{author: {login: $last}, createdAt: "2026-10-21T00:00:00Z"}]}};
  def ci($state): .commits.nodes[0].commit.statusCheckRollup = {state: $state};

  {data: {viewer: {login: "viewer"}, repository: {pullRequests: {pageInfo: {hasNextPage: false}, nodes: [
    (pr(1; "viewer") | both | ci("FAILURE") | .mergeable = "CONFLICTING"),
    (pr(2; "viewer") | both | .mergeable = "CONFLICTING"),
    (pr(3; "viewer") | .isDraft = true),
    (pr(4; "viewer") | inline | .reviewThreads.nodes = [thread("andy"; "andy")]),
    (pr(5; "viewer") | both | .reviewDecision = "APPROVED"),
    pr(6; "viewer"),
    (pr(7; "someone") | inline | assign(["andy"]) | .reviewThreads.nodes = [thread("viewer"; "someone")]),
    (pr(8; "someone") | assign(["viewer"])),
    (pr(9; "someone") | both | assign(["viewer"])),
    (pr(10; "someone") | both | assign(["viewer"]) | .reviewDecision = "APPROVED"),
    pr(11; "someone"),
    (pr(12; "someone") | both),
    (pr(13; "someone") | assign(["andy"])),
    (pr(14; "someone") | inline | assign(["viewer"]) | .reviewThreads.nodes = [thread("andy"; "andy")]),
    pr(15; "renovate[bot]"),
    (pr(16; "someone") | .isDraft = true | assign(["viewer"])),
    (pr(17; "viewer") | both | .reviewDecision = "CHANGES_REQUESTED"),
    (pr(18; "someone") | assign(["someone"])),
    (pr(19; "viewer") | both | ci("PENDING")),
    (pr(20; "someone") | inline | .reviewThreads.nodes = [thread("andy"; "someone")]),
    (pr(21; "viewer") | .reviewDecision = "APPROVED"),
    (pr(22; "viewer") | .reviewThreads.nodes = [thread("review-bot"; "review-bot")]),
    (pr(23; "someone") | both | assign(["viewer"]) | .mergeable = "CONFLICTING"),
    (pr(24; "someone") | both | assign(["viewer"]) | ci("FAILURE")),
    (pr(25; "someone") | inline | assign(["andy"]) | .reviewThreads.nodes = [thread("viewer"; "someone")]
      | .mergeable = "CONFLICTING" | ci("FAILURE"))
  ]}}}}' >"$tmp_dir/prs.json"

jq -n '{data: {search: {issueCount: 3, nodes: [
  {number: 100, title: "No PR yet", url: "https://github.com/acme/repo/issues/100",
   createdAt: "2026-10-12T12:00:00Z", labels: {nodes: [{name: "bug"}]},
   closedByPullRequestsReferences: {nodes: []}},
  {number: 101, title: "Draft PR open", url: "https://github.com/acme/repo/issues/101",
   createdAt: "2026-10-01T00:00:00Z", labels: {nodes: []},
   closedByPullRequestsReferences: {nodes: [{number: 3, url: "https://github.com/acme/repo/pull/3", isDraft: true}]}}
]}}}' >"$tmp_dir/issues.json"
jq -n '{data: {search: {issueCount: 0, nodes: []}}}' >"$tmp_dir/no-issues.json"
jq -n '[{ghsa_id: "GHSA-aaaa-bbbb-cccc", severity: "high", private_fork: null,
  summary: "Leak", created_at: "2026-10-20T12:00:00Z"}]' >"$tmp_dir/advisory.json"

# The fake gh answers auth checks, the advisory list ($FAKE_ADVISORIES for triage, [] for draft)
# and the issue search ($FAKE_ISSUES), and fails on anything else.
mkdir -p "$tmp_dir/bin"
cat >"$tmp_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
case "$*" in
  "auth status") exit 0 ;;
  *security-advisories?state=triage*) cat "$FAKE_ADVISORIES" ;;
  *security-advisories?state=draft*) echo "[]" ;;
  *"api graphql"*"assignee:@me"*) cat "$FAKE_ISSUES" ;;
  *"api graphql"*name=repo-ghsa-dddd-eeee-ffff*) cat "$FAKE_FORKS/fork-d.json" ;;
  *"api graphql"*name=repo-ghsa-kkkk-mmmm-nnnn*) cat "$FAKE_FORKS/fork-k.json" ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
GH
chmod +x "$tmp_dir/bin/gh"
echo "[]" >"$tmp_dir/no-advisories.json"

now=$(jq -n '"2026-10-22T12:00:00Z" | fromdateiso8601')
run() {
  PATH="$tmp_dir/bin:$PATH" PR_TRIAGE_FIXTURE="$tmp_dir/prs.json" PR_TRIAGE_NOW="$now" \
    PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" PR_TRIAGE_CODEOWNERS="${OWNERS:-$tmp_dir/CODEOWNERS}" \
    FAKE_ISSUES="${ISSUES:-$tmp_dir/issues.json}" FAKE_ADVISORIES="${ADVISORIES:-$tmp_dir/advisory.json}" \
    FAKE_FORKS="$tmp_dir" \
    NO_COLOR=1 bash "$my_work" -R acme/repo "$@"
}

report=$(run --json)
assert_eq "--json exits 0" "0" "$?"
refs() { jq -r --arg k "$1" '.sections[] | select(.key == $k) | [.items[].ref] | join(" ")' <<<"$report"; }
note() { jq -r --arg r "$1" '.sections[].items[] | select(.ref == $r) | .note' <<<"$report"; }

assert_eq "failing checks come first, even with conflicts" "#1" "$(refs MY_CI)"
assert_eq "merge conflicts on your PR" "#2" "$(refs MY_CONFLICTS)"
assert_eq "unresolved threads, even before the inline review, and a change request are feedback" \
  "#4 #17 #22" "$(refs MY_FEEDBACK)"
assert_eq "your approved PR waits to merge" "#5" "$(refs MY_APPROVED)"
assert_eq "your draft is listed for reference" "#3" "$(refs MY_DRAFTS)"
assert_eq "your PRs waiting on reviewers, even if approved early, are listed for reference" \
  "#6 #19 #21" "$(refs MY_WAITING)"
assert_eq "the author replied in your thread, even with failing checks and conflicts" "#7 #25" "$(refs REPLY)"
assert_eq "assigned to you, a skill to run" "#8" "$(refs ASSIGNED_SKILL)"
assert_eq "assigned to you, both skills done" "#9" "$(refs ASSIGNED_APPROVE)"
assert_eq "assigned to you, approved" "#10" "$(refs ASSIGNED_MERGE)"
assert_eq "unassigned, needs /pr-review-inline (author-only assignee counts as unassigned)" \
  "#11 #18" "$(refs PICKUP_INLINE)"
assert_eq "unassigned, past the inline review" "#12" "$(refs PICKUP_LATER)"
all_refs=$(jq -r '[.sections[].items[].ref] | join(" ")' <<<"$report")
for left_out in "#13" "#14" "#15" "#16" "#20" "#23" "#24"; do
  assert_eq "$left_out is not your turn and is left out" "" "$(grep -oE "(^| )$left_out( |$)" <<<"$all_refs")"
done
assert_eq "an issue with no open PR is listed" "#100" "$(refs ISSUES)"
assert_eq "an issue's labels are its note" "bug" "$(note "#100")"
assert_eq "an issue's age is counted from when it opened" "10" \
  "$(jq -r '.sections[].items[] | select(.ref == "#100") | .days' <<<"$report")"
assert_eq "the advisory without a fix PR is listed" "GHSA-aaaa-bbbb-cccc" "$(refs ADVISORIES)"
assert_eq "a note names every reason once" "needs another approver; merge conflicts; checks failing" \
  "$(note "#1")"
assert_eq "running checks are noted" "needs another approver; checks running" "$(note "#19")"
assert_eq "a change request is noted" "needs another approver; changes requested" "$(note "#17")"
assert_eq "more issues than were read is noted" \
  "You have more than 2 open issues: only the oldest were read." "$(jq -r '.notes[]' <<<"$report")"

non_owner=$(OWNERS="$tmp_dir/CODEOWNERS-without-viewer" run --json)
assert_eq "a non-codeowner gets no unassigned PRs" "" \
  "$(jq -r '[.sections[] | select(.group == "Unassigned PRs") | .items[].ref] | join(" ")' <<<"$non_owner")"
assert_eq "a non-codeowner still gets their own PRs" "#1" \
  "$(jq -r '.sections[] | select(.key == "MY_CI") | .items[].ref' <<<"$non_owner")"

text=$(run)
assert_eq "text output exits 0" "0" "$?"
assert_eq "text lists the sections in order" \
  "Your PRs|Reviewing|Your issues|Unassigned PRs|Security advisories|For reference" \
  "$(grep -E '^[A-Z]' <<<"$text" | grep -v '^My work' | paste -sd '|' -)"
assert_eq "text shows an advisory fix's severity" "1" "$(grep -c 'GHSA-aaaa-bbbb-cccc \[high\] Leak' <<<"$text")"

jq '.data.repository.pullRequests.nodes |= map(select(.number == 13 or .number == 14))' \
  "$tmp_dir/prs.json" >"$tmp_dir/not-mine.json"
nothing=$(ISSUES="$tmp_dir/no-issues.json" ADVISORIES="$tmp_dir/no-advisories.json" \
  PATH="$tmp_dir/bin:$PATH" PR_TRIAGE_FIXTURE="$tmp_dir/not-mine.json" PR_TRIAGE_NOW="$now" \
  PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" PR_TRIAGE_CODEOWNERS="$tmp_dir/CODEOWNERS" \
  FAKE_ISSUES="$tmp_dir/no-issues.json" FAKE_ADVISORIES="$tmp_dir/no-advisories.json" \
  NO_COLOR=1 bash "$my_work" -R acme/repo | tail -1)
assert_eq "with nothing your turn, the text says so" "Nothing is waiting on you." "$nothing"

out="$tmp_dir/report.html"
run --out "$out" --no-open >/dev/null
assert_eq "--html exits 0" "0" "$?"
assert_eq "the HTML is readable only by you" "600" "$(stat -c %a "$out" 2>/dev/null || stat -f %Lp "$out")"
embedded=$(sed -n '/<script type="application\/json" id="data">/,/<\/script>/p' "$out" | sed '1d;$d')
assert_eq "the HTML embeds the report" "acme/repo" "$(jq -r .repo <<<"$embedded")"

hostile='</script><script>alert(1)</script>'
jq --arg t "$hostile" '.data.search.nodes[0].title = $t' "$tmp_dir/issues.json" >"$tmp_dir/hostile-issues.json"
hostile_out="$tmp_dir/hostile.html"
ISSUES="$tmp_dir/hostile-issues.json" run --out "$hostile_out" --no-open >/dev/null
assert_eq "a title can't close the HTML's data block" "0" "$(grep -cF '<script>alert(1)' "$hostile_out")"
hostile_embedded=$(sed -n '/<script type="application\/json" id="data">/,/<\/script>/p' "$hostile_out" | sed '1d;$d')
assert_eq "the embedded JSON keeps that title intact" "$hostile" \
  "$(jq -r '.sections[].items[] | select(.ref == "#100") | .title' <<<"$hostile_embedded")"

mkdir -p "$tmp_dir/caller"
(cd / && INIT_CWD="$tmp_dir/caller" run --out relative.html --no-open >/dev/null)
assert_eq "a relative --out is written where pnpm was run" "yes" \
  "$([[ -f "$tmp_dir/caller/relative.html" ]] && echo yes || echo no)"

jq '.data.search.nodes[0].title = "Evil\u001b[2Ktitle\u009b"' "$tmp_dir/issues.json" >"$tmp_dir/escape-issues.json"
escaped=$(ISSUES="$tmp_dir/escape-issues.json" run)
assert_eq "a title's control characters never reach the terminal" "0" \
  "$(LC_ALL=C grep -c $'[\x1b]\\|\xc2\x9b' <<<"$escaped")"
assert_eq "a title's control characters become spaces" "1" "$(grep -c 'Evil \[2Ktitle' <<<"$escaped")"

run --json --html >/dev/null 2>&1
assert_eq "--json with --html is a usage error" "1" "$?"

# Advisory forks: their PRs carry latestOpinionatedReviews in place of reviewDecision, as the
# fork query asks, and go through the same sections as the repo's own.
fork_prs() {
  jq --arg url "https://github.com/$1/pull/" --argjson numbers "$2" \
    '.data.repository.pullRequests.nodes |= [.[] | select(.number | IN($numbers[]))
      | del(.reviewDecision) | .latestOpinionatedReviews = {nodes: []}
      | .url = $url + (.number | tostring)
      | if .number == 10 then .latestOpinionatedReviews.nodes =
          [{state: "APPROVED", author: {login: "andy"}, commit: {oid: "head"}}] else . end]' \
    "$tmp_dir/prs.json"
}
fork_prs acme/repo-ghsa-dddd-eeee-ffff '[1, 10, 11, 13]' >"$tmp_dir/fork-d.json"
fork_prs acme/repo-ghsa-kkkk-mmmm-nnnn '[3]' >"$tmp_dir/fork-k.json"
jq -n '[{ghsa_id: "GHSA-dddd-eeee-ffff", severity: "high",
    private_fork: {full_name: "acme/repo-ghsa-dddd-eeee-ffff"}, summary: "Fixing", created_at: "2026-10-18T00:00:00Z"},
  {ghsa_id: "GHSA-kkkk-mmmm-nnnn", severity: "low",
    private_fork: {full_name: "acme/repo-ghsa-kkkk-mmmm-nnnn"}, summary: "Drafting", created_at: "2026-10-19T00:00:00Z"}]' \
  >"$tmp_dir/fork-advisories.json"

forks=$(ADVISORIES="$tmp_dir/fork-advisories.json" run --json)
assert_eq "--json with advisory forks exits 0" "0" "$?"
fork_refs() { jq -r --arg k "$1" '.sections[] | select(.key == $k) | [.items[].ref] | join(" ")' <<<"$forks"; }
assert_eq "fork: your fix PR with failing checks comes before the repo's own PRs" \
  "GHSA-dddd-eeee-ffff #1 #1" "$(fork_refs MY_CI)"
assert_eq "fork: its card carries the advisory's ID and severity" "GHSA-dddd-eeee-ffff high" \
  "$(jq -r '.sections[].items[] | select(.ref == "GHSA-dddd-eeee-ffff #1") | "\(.advisory.ghsa) \(.advisory.severity)"' <<<"$forks")"
assert_eq "fork: its card links to the PR in the fork" \
  "https://github.com/acme/repo-ghsa-dddd-eeee-ffff/pull/1" \
  "$(jq -r '.sections[].items[] | select(.ref == "GHSA-dddd-eeee-ffff #1") | .url' <<<"$forks")"
assert_eq "fork: a codeowner's approval of the head makes an assigned fix PR ready to merge" \
  "GHSA-dddd-eeee-ffff #10 #10" "$(fork_refs ASSIGNED_MERGE)"
assert_eq "fork: an unassigned fix PR needs /pr-review-inline" \
  "GHSA-dddd-eeee-ffff #11 #11 #18" "$(fork_refs PICKUP_INLINE)"
assert_eq "fork: a fix PR assigned to someone else is left out" "" \
  "$(jq -r '.sections[].items[] | select(.ref == "GHSA-dddd-eeee-ffff #13") | .ref' <<<"$forks")"
assert_eq "fork: an advisory with only a draft fix PR has no fix PR" "GHSA-kkkk-mmmm-nnnn" "$(fork_refs ADVISORIES)"
assert_eq "fork: that advisory notes its draft" "draft fix PR open" \
  "$(jq -r '.sections[].items[] | select(.ref == "GHSA-kkkk-mmmm-nnnn") | .note' <<<"$forks")"
assert_eq "fork: your draft fix PR is listed with your drafts" "GHSA-kkkk-mmmm-nnnn #3 #3" "$(fork_refs MY_DRAFTS)"
fork_text=$(ADVISORIES="$tmp_dir/fork-advisories.json" run)
assert_eq "fork: text shows a fix PR's severity" "1" \
  "$(grep -c 'GHSA-dddd-eeee-ffff #1 \[high\] PR 1 (viewer)' <<<"$fork_text")"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures my-work test(s) failed"
  exit 1
fi
echo "All my-work tests passed"
