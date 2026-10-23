#!/usr/bin/env bash
# Regression tests for scripts/pr-triage.sh: one synthetic PR per stage, skill runs detected
# from anyone's markers (including a clean review's "no issues" comment), the cutoff for
# shape-based detection of runs from before the markers, the bot timeout, the viewer's own
# PRs, and that a hostile PR title can't break out of the HTML board's data block.
# Run directly: bash scripts/pr-triage.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
triage="${script_dir}/pr-triage.sh"
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

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/pr-triage-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

# Every PR defaults to: ready, opened long ago, all three bots finished, no skill runs,
# no threads. Each case overrides only what it tests.
jq -n '
  def bots_done: [
    {__typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS", description: "Review completed"},
    {__typename: "CheckRun", name: "Greptile Review", status: "COMPLETED"}
  ];
  def qodo: {author: {login: "qodo-free-for-open-source-projects"}, body: "<h3>Code Review by Qodo</h3>"};
  def pr($n; $title; $author): {
    number: $n, title: $title, url: "https://github.com/acme/repo/pull/\($n)",
    isDraft: false, createdAt: "2026-10-01T00:00:00Z", reviewDecision: null, mergeable: "MERGEABLE",
    author: {login: $author},
    timelineItems: {nodes: []},
    commits: {nodes: [{commit: {committedDate: "2026-10-01T00:00:00Z",
      statusCheckRollup: {contexts: {nodes: bots_done}}}}]},
    comments: {nodes: [qodo]},
    reviews: {nodes: []},
    reviewThreads: {nodes: []}
  };
  def review($by; $at; $body; $comments): {author: {login: $by}, submittedAt: $at, body: $body,
    comments: {nodes: ($comments | map({body: ., replyTo: null}))}};
  def inline_review: review("andy"; "2026-10-22T00:00:00Z"; "";
    ["Fix this.\n<!-- pr-review-inline -->\n_written by Model_"]);
  def local_review: review("andy"; "2026-10-22T01:00:00Z";
    "| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; []);
  def thread($resolved; $by): {isResolved: $resolved, comments: {nodes: [{author: {login: $by}}]}};

  {data: {viewer: {login: "viewer"}, repository: {pullRequests: {pageInfo: {hasNextPage: false}, nodes: [
    (pr(1; "draft"; "someone") | .isDraft = true),
    pr(2; "deps"; "renovate"),
    (pr(3; "bots running"; "someone")
      | .commits.nodes[0].commit.committedDate = "2026-10-22T11:30:00Z"
      | .commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].state = "PENDING"),
    (pr(4; "bot never showed"; "someone") | .comments.nodes = []),
    pr(5; "fresh"; "someone"),
    (pr(6; "clean inline review by someone else"; "someone")
      | .comments.nodes += [{author: {login: "luis"}, body: "No issues found.\n<!-- pr-review-inline -->"}]),
    (pr(7; "open threads"; "someone") | .reviews.nodes = [inline_review]
      | .reviewThreads.nodes = [thread(false; "andy"), thread(true; "coderabbitai")]),
    (pr(8; "both skills done"; "someone") | .reviews.nodes = [inline_review, local_review]),
    (pr(9; "approved"; "someone") | .reviews.nodes = [inline_review, local_review]
      | .reviewDecision = "APPROVED"),
    (pr(10; "viewer owns it"; "viewer") | .reviews.nodes = [inline_review, local_review]),
    (pr(11; "pre-marker review"; "someone")
      | .reviews.nodes = [review("andy"; "2026-10-15T00:00:00Z"; ""; ["Old finding.\n_written by Model_"])]),
    (pr(12; "unmarked AI comment after cutoff"; "someone")
      | .reviews.nodes = [review("bot-user"; "2026-10-22T00:00:00Z"; ""; ["Some note.\n_written by Model_"])]),
    (pr(13; "</script><img src=x onerror=alert(1)>"; "someone") | .isDraft = true),
    (pr(14; "bot rerun just started on an old commit"; "someone")
      | .commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0] +=
          {state: "PENDING", createdAt: "2026-10-22T11:50:00Z"}),
    (pr(15; "bot run stuck for hours"; "someone")
      | .commits.nodes[0].commit.statusCheckRollup.contexts.nodes[1] +=
          {status: "IN_PROGRESS", startedAt: "2026-10-22T08:00:00Z"}),
    (pr(16; "first line\nsecond line"; "someone")),
    (pr(17; "over 100 threads"; "someone") | .reviews.nodes = [inline_review]
      | .reviewThreads = {pageInfo: {hasNextPage: true}, nodes: [thread(true; "andy")]})
  ]}}}}' >"$tmp_dir/fixture.json"

now=$(jq -n '"2026-10-22T12:00:00Z" | fromdateiso8601')

run_triage() {
  PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" \
    PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" NO_COLOR=1 \
    bash "$triage" -R acme/repo "$@"
}

run_triage --out "$tmp_dir/board.html" --no-open >"$tmp_dir/html.out" 2>&1
status=$?
assert_eq "--html exits 0" "0" "$status"

board_json() {
  sed -n '/<script type="application\/json" id="data">/,/<\/script>/p' "$tmp_dir/board.html" \
    | sed '1d;$d'
}
bucket_of() { board_json | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .bucket'; }
note_of() { board_json | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .note'; }

assert_eq "board JSON parses" "acme/repo" "$(board_json | jq -r .repo)"
assert_eq "draft is ignored" "DRAFT" "$(bucket_of 1)"
assert_eq "Renovate is skipped" "SKIP" "$(bucket_of 2)"
assert_eq "a bot still reviewing a fresh push holds the PR" "BOTS" "$(bucket_of 3)"
assert_eq "a bot missing for over 2h stops blocking" "INLINE" "$(bucket_of 4)"
assert_eq "a bot missing for over 2h is noted" "gave up waiting on Qodo" "$(note_of 4)"
assert_eq "no skill run needs /pr-review-inline" "INLINE" "$(bucket_of 5)"
assert_eq "another person's clean-review comment counts" "LOCAL" "$(bucket_of 6)"
assert_eq "an unresolved thread waits on the author" "THREADS" "$(bucket_of 7)"
assert_eq "thread note names who opened it" "1 unresolved (andy 1)" "$(note_of 7)"
assert_eq "both skills done needs approval" "MANUAL" "$(bucket_of 8)"
assert_eq "approved waits to merge" "MERGE" "$(bucket_of 9)"
assert_eq "the viewer's own finished PR" "OWN" "$(bucket_of 10)"
assert_eq "a review from before the markers is recognized" "LOCAL" "$(bucket_of 11)"
assert_eq "an unmarked AI comment after the cutoff isn't a skill run" "INLINE" "$(bucket_of 12)"
assert_eq "a bot run started minutes ago holds the PR, however old the commit" "BOTS" "$(bucket_of 14)"
assert_eq "a bot run started over 2h ago stops blocking" "INLINE" "$(bucket_of 15)"
assert_eq "a bot run started over 2h ago is noted" "gave up waiting on Greptile" "$(note_of 15)"
assert_eq "a multiline title is flattened" "first line second line" \
  "$(board_json | jq -r '.prs[] | select(.number == 16) | .title')"
assert_eq "threads past the first 100 hold the PR" "THREADS" "$(bucket_of 17)"
assert_eq "threads past the first 100 are noted" "over 100 threads, check the rest on GitHub" \
  "$(note_of 17)"

hostile_count=$(grep -c '</script><img' "$tmp_dir/board.html")
assert_eq "a hostile title can't close the data block" "0" "$hostile_count"
assert_eq "the hostile title survives escaped" "</script><img src=x onerror=alert(1)>" \
  "$(board_json | jq -r '.prs[] | select(.number == 13) | .title')"

run_triage >"$tmp_dir/text.out" 2>&1
status=$?
assert_eq "text mode exits 0" "0" "$status"
assert_eq "text mode lists /pr-local-test PRs first" "Run /pr-local-test" "$(sed -n 3p "$tmp_dir/text.out")"
assert_eq "text mode shows the empty-note url on its own line" \
  "         https://github.com/acme/repo/pull/5" \
  "$(grep -A1 '#5 ' "$tmp_dir/text.out" | tail -1)"
assert_eq "text mode keeps a multiline title's card on one line" \
  "  #16    first line second line (someone)" "$(grep '#16 ' "$tmp_dir/text.out")"
assert_eq "text mode counts drafts" "2 drafts ignored; skipped (Renovate/release-please): #2 " \
  "$(tail -1 "$tmp_dir/text.out")"

ledger="$tmp_dir/ledger.tsv"
printf 'acme/repo\t5\tpr-review-inline\tsha\t2026-10-22T00:00:00Z\n' >"$ledger"
PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$ledger" \
  bash "$triage" -R acme/repo --out "$tmp_dir/ledger.html" --no-open >/dev/null 2>&1
assert_eq "a local ledger entry counts as a run" "LOCAL" \
  "$(sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/ledger.html" | sed '1d;$d' \
    | jq -r '.prs[] | select(.number == 5) | .bucket')"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} pr-triage test(s) failed"
  exit 1
fi
echo "All pr-triage tests passed"
