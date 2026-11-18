#!/usr/bin/env bash
# Regression tests for scripts/pr-triage.sh, run against synthetic PR fixtures and a fake gh.
# Run directly: bash scripts/pr-triage.test.sh
set -uo pipefail

# pr-triage itself needs jq, but `pnpm lint` runs this for everyone, so don't fail lint for it.
if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: pr-triage tests need jq, which isn't installed"
  exit 0
fi

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

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/pr-triage-test.XXXXXX")" || exit 1

# "Andy" in a different case from the fixture's "andy", so every match is case-insensitive.
cat >"$tmp_dir/CODEOWNERS" <<'OWNERS'
# @not-an-owner is only mentioned in a comment
*        @Andy @luis # @also-not-an-owner
/apps/   @luis
OWNERS
export PR_TRIAGE_CODEOWNERS="$tmp_dir/CODEOWNERS"

# Every PR defaults to: ready, opened long ago, no skill runs, no threads. Each case
# overrides only what it tests.
jq -n '
  def pr($n; $title; $author): {
    number: $n, title: $title, url: "https://github.com/acme/repo/pull/\($n)",
    isDraft: false, createdAt: "2026-10-01T00:00:00Z", reviewDecision: null, mergeable: "MERGEABLE",
    author: {login: $author},
    timelineItems: {nodes: []},
    commits: {nodes: [{commit: {oid: "first", committedDate: "2026-10-01T00:00:00Z"}}]},
    comments: {nodes: []},
    reviews: {nodes: []},
    reviewThreads: {nodes: []}
  };
  # Every review is on the first commit, which stays the head until pushed().
  def review($by; $at; $body; $comments): {author: {login: $by}, submittedAt: $at, body: $body,
    commit: {oid: "first"},
    comments: {nodes: ($comments | map({author: {login: $by}, body: ., replyTo: null}))}};
  def inline_review: review("andy"; "2026-10-22T00:00:00Z"; "";
    ["Fix this.\n<!-- pr-review-inline -->\n_written by Model_"]);
  def local_review: review("andy"; "2026-10-22T01:00:00Z";
    "| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; []);
  def blocked_review($at; $apostrophe): review("andy"; $at;
    "⏸️ **Can\($apostrophe)t recommend yet:** sign-in wasn\($apostrophe)t tested.\n| Check | Result |\n"
    + "<!-- pr-local-test -->\n_written by Model_"; []);
  def failed_review($at): review("andy"; $at;
    "❌ **Needs changes before approval:** sign-in breaks.\n| Check | Result |\n"
    + "<!-- pr-local-test -->\n_written by Model_"; []);
  def thread($resolved; $by): {isResolved: $resolved, comments: {nodes: [{author: {login: $by}}]},
    lastComment: {nodes: [{author: {login: $by}, createdAt: "2026-10-21T00:00:00Z"}]}};
  # A thread someone opened whose last comment is the PR author'"'"'s reply.
  def replied($by; $author; $at): thread(false; $by)
    | .lastComment.nodes = [{author: {login: $author}, createdAt: $at}];
  def add_label_by($name; $at; $by): .labels.nodes += [{name: $name}]
    | .labelEvents.nodes += [{createdAt: $at, actor: {login: $by}, label: {name: $name}}];
  def add_label($name; $at): add_label_by($name; $at; "andy");
  def pushed($at): .commits.nodes[0].commit |= (.oid = "pushed" | .committedDate = $at);

  {data: {viewer: {login: "viewer"}, repository: {pullRequests: {pageInfo: {hasNextPage: false}, nodes: [
    (pr(1; "draft"; "someone") | .isDraft = true),
    pr(2; "deps"; "renovate"),
    (pr(3; "pushed minutes ago"; "someone") | pushed("2026-10-22T11:30:00Z")),
    pr(5; "fresh"; "someone"),
    (pr(6; "clean inline review by someone else"; "someone")
      | .comments.nodes += [{author: {login: "luis"}, body: "No issues found.\n<!-- pr-review-inline -->"}]),
    (pr(7; "open threads"; "someone") | .reviews.nodes = [inline_review]
      | .assignees = {nodes: [{login: "amy"}, {login: "cy"}]}
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
    (pr(16; "first line\nsecond line"; "someone")),
    (pr(17; "over 100 threads"; "someone") | .reviews.nodes = [inline_review]
      | .reviewThreads = {pageInfo: {hasNextPage: true}, nodes: [thread(true; "andy")]}),
    (pr(18; "marker quoted by a review bot"; "someone")
      | .comments.nodes += [{author: {login: "coderabbitai", __typename: "Bot"},
          body: "Quoting <!-- pr-review-inline -->"}]),
    pr(19; "lookalike author"; "renovated-ideas"),
    (pr(20; "conflicts with open thread"; "someone") | .mergeable = "CONFLICTING"
      | .reviews.nodes = [inline_review, local_review] | .reviewThreads.nodes = [thread(false; "andy")]),
    (pr(21; "conflicts, ready for approval"; "someone") | .mergeable = "CONFLICTING"
      | .reviews.nodes = [inline_review, local_review]),
    (pr(22; "conflicting draft"; "someone") | .isDraft = true | .mergeable = "CONFLICTING"),
    (pr(26; "marked ready minutes ago"; "someone")
      | .timelineItems.nodes = [{createdAt: "2026-10-22T11:45:00Z"}]),
    (pr(27; "markers only among the oldest reviews and comments"; "someone")
      | .firstReviews.nodes = [inline_review, local_review]),
    (pr(28; "clean review note only among the oldest comments"; "someone")
      | .firstComments.nodes = [{author: {login: "luis", __typename: "User"},
          body: "No issues found.\n<!-- pr-review-inline -->"}]),
    (pr(29; "local test blocked"; "someone")
      | .reviews.nodes = [inline_review, blocked_review("2026-10-22T02:00:00Z"; "'"'"'")]),
    (pr(30; "blocked, then rerun and passed"; "someone")
      | .reviews.nodes = [inline_review, blocked_review("2026-10-22T00:30:00Z"; "'"'"'"), local_review]),
    (pr(31; "local test blocked, curly apostrophe"; "someone")
      | .reviews.nodes = [inline_review, blocked_review("2026-10-22T02:00:00Z"; "\u2019")]),
    (pr(32; "release"; "f3-nation-release-please") | .author.__typename = "Bot"),
    (pr(33; "a person whose login mentions release-please"; "release-please-fan")
      | .author.__typename = "User"),
    (pr(34; "assigned to the viewer"; "someone")
      | .assignees = {nodes: [{login: "amy"}, {login: "viewer"}]}),
    (pr(35; "clean inline review by a non-codeowner"; "someone")
      | .comments.nodes += [{author: {login: "not-an-owner"}, body: "No issues found.\n<!-- pr-review-inline -->"}]),
    (pr(36; "both skills run by a non-codeowner"; "someone")
      | .reviews.nodes = [inline_review, local_review | .author.login = "drive-by"]
      | .reviews.nodes[0] |= (.author.login = "drive-by" | .comments.nodes[].author.login = "drive-by")),
    (pr(37; "pre-marker review by a non-codeowner"; "someone")
      | .reviews.nodes = [review("also-not-an-owner"; "2026-10-15T00:00:00Z"; ""; ["Old finding.\n_written by Model_"])]),
    (pr(38; "local test failed, then pushed"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | pushed("2026-10-22T02:30:00Z")),
    (pr(39; "failed, then rerun and passed"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T00:30:00Z"), local_review]),
    (pr(40; "failed, then labeled not needed"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | add_label("local test: not needed"; "2026-10-22T03:00:00Z")),
    (pr(41; "blocked, then labeled not needed"; "someone")
      | .reviews.nodes = [inline_review, blocked_review("2026-10-22T02:00:00Z"; "'"'"'")]
      | add_label("local test: not needed"; "2026-10-22T03:00:00Z")),
    (pr(42; "labeled not needed, then failed, then pushed"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | add_label("local test: not needed"; "2026-10-22T01:00:00Z")
      | pushed("2026-10-22T02:30:00Z")),
    (pr(43; "never tested, labeled not needed"; "someone") | .reviews.nodes = [inline_review]
      | add_label("local test: not needed"; "2026-10-22T03:00:00Z")),
    (pr(44; "author replied in every thread"; "pax") | .reviews.nodes = [inline_review]
      | .authorAssociation = "CONTRIBUTOR"
      | .assignees = {nodes: [{login: "pax"}, {login: "ANDY"}, {login: "drive-by"}]}
      | .reviewThreads.nodes = [replied("andy"; "pax"; "2026-10-22T05:00:00Z"),
          replied("coderabbitai"; "pax"; "2026-10-22T04:00:00Z")]),
    (pr(45; "author replied in only one thread"; "pax") | .reviews.nodes = [inline_review]
      | .reviewThreads.nodes = [replied("andy"; "pax"; "2026-10-22T05:00:00Z"), thread(false; "luis")]),
    (pr(46; "a codeowner'"'"'s own PR"; "Luis") | .reviews.nodes = [inline_review]
      | .assignees = {nodes: [{login: "luis"}]}),
    (pr(47; "author replied, over 100 threads"; "pax") | .reviews.nodes = [inline_review]
      | .reviewThreads = {pageInfo: {hasNextPage: true},
          nodes: [replied("andy"; "pax"; "2026-10-22T05:00:00Z")]}),
    (pr(48; "failed, then labeled by a non-codeowner"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | add_label_by("local test: not needed"; "2026-10-22T03:00:00Z"; "drive-by")
      | pushed("2026-10-22T02:30:00Z")),
    (pr(49; "codeowner failed, then a non-codeowner passed"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z"),
          review("drive-by"; "2026-10-22T03:00:00Z"; "| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; [])]
      | pushed("2026-10-22T02:30:00Z")),
    (pr(50; "local test failed, no push since"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]),
    (pr(51; "author pinged in the conversation"; "someone") | .reviews.nodes = [inline_review]
      | .comments.nodes += [
          {author: {login: "someone"}, body: "any update?", createdAt: "2026-10-22T06:00:00Z"},
          {author: {login: "drive-by"}, body: "+1", createdAt: "2026-10-22T08:00:00Z"}]
      | .reviewThreads.nodes = [thread(false; "andy")
          | .lastComment.nodes[0].createdAt = "2026-10-22T09:00:00Z"]),
    (pr(52; "a resolved thread"; "someone") | .reviews.nodes = [inline_review]
      | .reviewThreads.nodes = [thread(true; "andy")
          | .lastComment.nodes[0].createdAt = "2026-10-22T07:00:00Z"]),
    (pr(53; "reopened"; "someone")
      | .reopened = {nodes: [{createdAt: "2026-10-20T00:00:00Z"}]}),
    (pr(54; "failed, codeowner labeled, then a non-codeowner labeled again"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | add_label("local test: not needed"; "2026-10-22T03:00:00Z")
      | add_label_by("local test: not needed"; "2026-10-22T04:00:00Z"; "drive-by")
      | .labels.nodes |= unique),
    (pr(55; "failed, then pushed a fix committed before the report"; "someone")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | pushed("2026-10-22T01:30:00Z")),
    (pr(56; "failed, no push, author replied in every thread"; "pax")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z")]
      | .reviewThreads.nodes = [replied("andy"; "pax"; "2026-10-22T05:00:00Z")]),
    (pr(57; "codeowner author reruns the local test on their own PR"; "Luis")
      | .reviews.nodes = [inline_review, failed_review("2026-10-22T02:00:00Z"),
          (review("luis"; "2026-10-22T03:00:00Z"; "| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; [])
            | .commit.oid = "pushed")]
      | pushed("2026-10-22T02:30:00Z")),
    (pr(59; "local test said do not approve yet"; "someone")
      | .reviews.nodes = [inline_review, review("andy"; "2026-10-22T02:00:00Z";
          "❌ Recommendation: Don'"'"'t approve yet\n| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; [])]
      | pushed("2026-10-22T02:30:00Z")),
    (pr(60; "codeowner author ran pr-review-inline on their own PR"; "Luis")
      | .reviews.nodes = [inline_review | .author.login = "luis" | .comments.nodes[].author.login = "luis"]),
    (pr(61; "codeowner author'"'"'s own clean-review comment"; "Luis")
      | .comments.nodes += [{author: {login: "luis"}, body: "No issues found.\n<!-- pr-review-inline -->",
          createdAt: "2026-10-22T03:00:00Z"}]),
    (pr(62; "codeowner author ran pr-local-test on their own PR"; "Luis")
      | .reviews.nodes = [inline_review,
          review("luis"; "2026-10-22T03:00:00Z"; "| Check | Result |\n<!-- pr-local-test -->\n_written by Model_"; [])]),
    (pr(63; "codeowner author'"'"'s own pre-marker review"; "Luis")
      | .reviews.nodes = [review("luis"; "2026-10-15T00:00:00Z"; ""; ["Old finding.\n_written by Model_"])]),
    pr(64; "viewer'"'"'s own PR in their ledger"; "viewer"),
    (pr(65; "author opened threads of their own"; "pax") | .reviews.nodes = [inline_review]
      | .reviewThreads.nodes = [replied("andy"; "pax"; "2026-10-22T05:00:00Z"),
          (thread(false; "pax") | .lastComment.nodes[0].createdAt = "2026-10-22T08:00:00Z"),
          (thread(true; "pax") | .lastComment.nodes[0].createdAt = "2026-10-22T09:00:00Z")]),
    (pr(66; "codeowner author labels their own PR not needed"; "Luis") | .reviews.nodes = [inline_review]
      | add_label_by("local test: not needed"; "2026-10-22T03:00:00Z"; "luis")),
    (pr(67; "another codeowner labels a codeowner'"'"'s PR not needed"; "Luis") | .reviews.nodes = [inline_review]
      | add_label_by("local test: not needed"; "2026-10-22T03:00:00Z"; "andy")),
    (pr(68; "author replied in the viewer'"'"'s thread"; "pax") | .reviews.nodes = [inline_review]
      | .reviewThreads.nodes = [replied("Viewer"; "pax"; "2026-10-22T05:00:00Z")]),
    (pr(69; "author replied to a bot, viewer assigned"; "pax") | .reviews.nodes = [inline_review]
      | .assignees = {nodes: [{login: "viewer"}]}
      | .reviewThreads.nodes = [replied("coderabbitai"; "pax"; "2026-10-22T05:00:00Z")]),
    (pr(70; "author replied to a codeowner, viewer assigned"; "pax") | .reviews.nodes = [inline_review]
      | .assignees = {nodes: [{login: "viewer"}]}
      | .reviewThreads.nodes = [replied("andy"; "pax"; "2026-10-22T05:00:00Z")]),
    (pr(71; "open threads, viewer assigned"; "someone") | .reviews.nodes = [inline_review]
      | .assignees = {nodes: [{login: "viewer"}]} | .reviewThreads.nodes = [thread(false; "andy")]),
    (pr(72; "author replied in the viewer'"'"'s thread, another codeowner assigned"; "pax")
      | .reviews.nodes = [inline_review] | .assignees = {nodes: [{login: "andy"}]}
      | .reviewThreads.nodes = [replied("viewer"; "pax"; "2026-10-22T05:00:00Z")])
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
assert_eq "a fresh push goes straight to /pr-review-inline" "INLINE" "$(bucket_of 3)"
assert_eq "a fresh push gets no note" "" "$(note_of 3)"
assert_eq "no skill run needs /pr-review-inline" "INLINE" "$(bucket_of 5)"
assert_eq "a codeowner's clean-review comment counts" "LOCAL" "$(bucket_of 6)"
assert_eq "an unresolved thread waits on the author" "THREADS" "$(bucket_of 7)"
assert_eq "thread note names who opened it" "1 unresolved (andy 1)" "$(note_of 7)"
assert_eq "both skills done needs approval" "MANUAL" "$(bucket_of 8)"
assert_eq "approved waits to merge" "MERGE" "$(bucket_of 9)"
assert_eq "the viewer's own finished PR" "OWN" "$(bucket_of 10)"
assert_eq "a review from before the markers is recognized" "LOCAL" "$(bucket_of 11)"
assert_eq "an unmarked AI comment after the cutoff isn't a skill run" "INLINE" "$(bucket_of 12)"
assert_eq "a multiline title is flattened" "first line second line" \
  "$(board_json | jq -r '.prs[] | select(.number == 16) | .title')"
assert_eq "threads past the first 100 hold the PR" "THREADS" "$(bucket_of 17)"
assert_eq "threads past the first 100 are noted" "over 100 threads, check the rest on GitHub" \
  "$(note_of 17)"
assert_eq "a marker quoted by a bot isn't a skill run" "INLINE" "$(bucket_of 18)"
assert_eq "an author merely containing renovate isn't skipped" "INLINE" "$(bucket_of 19)"
assert_eq "conflicts are noted beside open threads and finished skills" \
  "1 unresolved (andy 1); both skills done; merge conflicts" "$(note_of 20)"
assert_eq "a conflicting PR still awaits approval" "MANUAL" "$(bucket_of 21)"
assert_eq "conflicts are noted on a PR awaiting approval" "merge conflicts" "$(note_of 21)"
assert_eq "a conflicting draft gets no note" "" "$(note_of 22)"
assert_eq "a PR marked ready minutes ago goes straight to /pr-review-inline" "INLINE" "$(bucket_of 26)"
assert_eq "skill markers among the oldest reviews still count" "MANUAL" "$(bucket_of 27)"
assert_eq "a clean-review note among the oldest comments still counts" "LOCAL" "$(bucket_of 28)"
assert_eq "a blocked local test still needs /pr-local-test" "LOCAL" "$(bucket_of 29)"
assert_eq "a blocked local test is noted" "last local test could not recommend yet" "$(note_of 29)"
assert_eq "a rerun that passed after a blocked one counts" "MANUAL" "$(bucket_of 30)"
assert_eq "a blocked report with a curly apostrophe is recognized" "LOCAL" "$(bucket_of 31)"
assert_eq "a release-please bot with a prefixed login is skipped" "SKIP" "$(bucket_of 32)"
assert_eq "a person whose login mentions release-please isn't skipped" "INLINE" "$(bucket_of 33)"

assert_eq "a non-codeowner's clean-review comment doesn't count" "INLINE" "$(bucket_of 35)"
assert_eq "a non-codeowner's markers don't count" "INLINE" "$(bucket_of 36)"
assert_eq "a non-codeowner's pre-marker review doesn't count" "INLINE" "$(bucket_of 37)"
assert_eq "a failed local test with a push since holds the PR" "LOCAL" "$(bucket_of 38)"
assert_eq "a failed local test is noted" "last local test said don't approve yet" "$(note_of 38)"
assert_eq "a failed local test with no push since waits on the author" "THREADS" "$(bucket_of 50)"
assert_eq "...and says so" "local test asked for changes; waiting on a push" "$(note_of 50)"
assert_eq "a non-codeowner's label doesn't clear a failed local test" "LOCAL" "$(bucket_of 48)"
assert_eq "an earlier codeowner add doesn't vouch for a later non-codeowner add" "THREADS" "$(bucket_of 54)"
assert_eq "a fix committed before the report but pushed after it releases the wait" "LOCAL" "$(bucket_of 55)"
assert_eq "a failed local test with no push keeps author replies out of REPLY" "THREADS" "$(bucket_of 56)"
assert_eq "...and notes both" "1 unresolved (andy 1); local test asked for changes; waiting on a push" "$(note_of 56)"
assert_eq "a codeowner author's own rerun doesn't release another codeowner's ❌" "LOCAL" "$(bucket_of 57)"
assert_eq "...and the hold is still noted" "last local test said don't approve yet" "$(note_of 57)"
assert_eq "\"Don't approve yet\" alone holds the PR" "LOCAL" "$(bucket_of 59)"
assert_eq "...and is noted" "last local test said don't approve yet" "$(note_of 59)"
assert_eq "a non-codeowner's later pass doesn't release a hold" "LOCAL" "$(bucket_of 49)"
assert_eq "...and the hold is still noted" "last local test said don't approve yet" "$(note_of 49)"
assert_eq "an author reply past 100 threads still waits in THREADS" "THREADS" "$(bucket_of 47)"
assert_eq "...and says so" "1 unresolved (andy 1); over 100 threads, check the rest on GitHub" "$(note_of 47)"
assert_eq "a rerun that passed after a failed one counts" "MANUAL" "$(bucket_of 39)"
assert_eq "the label added after a failed local test clears it" "MANUAL" "$(bucket_of 40)"
assert_eq "the label added after a blocked local test clears it" "MANUAL" "$(bucket_of 41)"
assert_eq "the label added before a failed local test doesn't clear it" "LOCAL" "$(bucket_of 42)"
assert_eq "the label stands in for a local test that never ran" "MANUAL" "$(bucket_of 43)"
assert_eq "every thread ending with the author's reply waits on a reviewer" "REPLY" "$(bucket_of 44)"
assert_eq "a reviewer-reply note names who opened the threads" \
  "2 unresolved, author replied (andy 1, coderabbitai 1)" "$(note_of 44)"
assert_eq "a thread still waiting on the author keeps the PR in THREADS" "THREADS" "$(bucket_of 45)"
assert_eq "another codeowner's run counts on a codeowner's own PR" "LOCAL" "$(bucket_of 46)"
assert_eq "the author's own pr-review-inline doesn't count" "INLINE" "$(bucket_of 60)"
assert_eq "the author's own clean-review comment doesn't count" "INLINE" "$(bucket_of 61)"
assert_eq "the author's own pr-local-test doesn't count" "LOCAL" "$(bucket_of 62)"
assert_eq "the author's own pre-marker review doesn't count" "INLINE" "$(bucket_of 63)"
assert_eq "the author's own not-needed label doesn't skip the local test" "LOCAL" "$(bucket_of 66)"
assert_eq "another codeowner's not-needed label skips the local test" "MANUAL" "$(bucket_of 67)"

hostile_count=$(grep -c '</script><img' "$tmp_dir/board.html")
assert_eq "the board records Unassigned for a PR with no assignee" "Unassigned" \
  "$(board_json | jq -r '.prs[] | select(.number == 5) | .assignee')"
assert_eq "the board records every assignee" "amy, cy" \
  "$(board_json | jq -r '.prs[] | select(.number == 7) | .assignee')"
assert_eq "a PR assigned to the viewer among others is marked assigned to them" "true" \
  "$(board_json | jq -r '.prs[] | select(.number == 34) | .assignedToMe')"
assert_eq "a PR assigned only to others isn't marked assigned to the viewer" "false" \
  "$(board_json | jq -r '.prs[] | select(.number == 7) | .assignedToMe')"
assert_eq "an unassigned PR isn't marked assigned to the viewer" "false" \
  "$(board_json | jq -r '.prs[] | select(.number == 5) | .assignedToMe')"
claimed_of() { board_json | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .claimedByOther'; }
assert_eq "a PR assigned to others than the author is claimed by someone else" "true" "$(claimed_of 7)"
assert_eq "...even when the viewer is assigned too" "true" "$(claimed_of 34)"
assert_eq "an author assigned to their own PR, in any case, hasn't been claimed by someone else" "false" \
  "$(claimed_of 46)"
assert_eq "an unassigned PR isn't claimed by someone else" "false" "$(claimed_of 5)"
turn_of() { board_json | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .viewersTurn'; }
assert_eq "the viewer's own PR is always theirs to move" "true" "$(turn_of 10)"
assert_eq "an unassigned PR needing a skill run can be the viewer's" "true" "$(turn_of 5)"
assert_eq "a PR someone else has taken on isn't the viewer's" "false" "$(turn_of 7)"
assert_eq "a PR the viewer shares with someone else can be theirs" "true" "$(turn_of 34)"
assert_eq "a PR only its author is assigned to can be the viewer's" "true" "$(turn_of 46)"
assert_eq "open threads assigned to the viewer wait on the author, not them" "false" "$(turn_of 71)"
assert_eq "an author's reply in the viewer's thread, in any case, is theirs to answer" "true" "$(turn_of 68)"
assert_eq "an author's reply to a bot falls to the assigned viewer" "true" "$(turn_of 69)"
assert_eq "an author's reply to another codeowner isn't the assigned viewer's" "false" "$(turn_of 70)"
assert_eq "an author's reply in the viewer's thread is theirs even when someone else is assigned" "true" \
  "$(turn_of 72)"
assert_eq "the board has a filter for PRs that are the viewer's responsibility" "1" \
  "$(grep -c '\["responsible", "My responsibility", (pr) => pr.viewersTurn\]' "$tmp_dir/board.html")"
assert_eq "a hostile title can't close the data block" "0" "$hostile_count"
assert_eq "the hostile title survives escaped" "</script><img src=x onerror=alert(1)>" \
  "$(board_json | jq -r '.prs[] | select(.number == 13) | .title')"

run_triage --json >"$tmp_dir/board.json" 2>"$tmp_dir/json.err"
status=$?
assert_eq "--json exits 0" "0" "$status"
json_field() { jq -c --argjson n "$1" ".prs[] | select(.number == \$n) | $2" "$tmp_dir/board.json"; }
assert_eq "--json prints the same board as --html" "$(board_json | jq -c .)" "$(jq -c . "$tmp_dir/board.json")"
assert_eq "--json lists every assignee" '["pax","ANDY","drive-by"]' "$(json_field 44 .assignees)"
assert_eq "codeownerAssignees keeps codeowners other than the author" '["ANDY"]' \
  "$(json_field 44 .codeownerAssignees)"
assert_eq "codeownerAssignees leaves out a codeowner author, in any case" '[]' \
  "$(json_field 46 .codeownerAssignees)"
assert_eq "authorIsCodeowner matches in any case" "true" "$(json_field 46 .authorIsCodeowner)"
assert_eq "authorIsCodeowner is false for anyone else" "false" "$(json_field 44 .authorIsCodeowner)"
assert_eq "authorAssociation is passed through" '"CONTRIBUTOR"' "$(json_field 44 .authorAssociation)"
assert_eq "a missing authorAssociation reads as NONE" '"NONE"' "$(json_field 5 .authorAssociation)"
assert_eq "threadOpeners lists who opened the unresolved threads" '["andy","coderabbitai"]' \
  "$(json_field 44 .threadOpeners)"
assert_eq "unresolvedThreads counts every open thread" "2" "$(json_field 44 .unresolvedThreads)"
assert_eq "turnSince is the author's latest thread reply" '"2026-10-22T05:00:00Z"' "$(json_field 44 .turnSince)"
assert_eq "turnSince is the newest skill report" '"2026-10-22T01:00:00Z"' "$(json_field 8 .turnSince)"
assert_eq "turnSince falls back to when the PR opened" '"2026-10-01T00:00:00Z"' "$(json_field 5 .turnSince)"
assert_eq "turnSince ignores conversation comments and a codeowner's thread comment" \
  '"2026-10-22T00:00:00Z"' "$(json_field 51 .turnSince)"
assert_eq "turnSince counts a resolved thread from its last comment" '"2026-10-22T07:00:00Z"' "$(json_field 52 .turnSince)"
assert_eq "turnSince counts the author's push" '"2026-10-22T11:30:00Z"' "$(json_field 3 .turnSince)"
assert_eq "turnSince counts being marked ready" '"2026-10-22T11:45:00Z"' "$(json_field 26 .turnSince)"
assert_eq "turnSince counts a reopen" '"2026-10-20T00:00:00Z"' "$(json_field 53 .turnSince)"
assert_eq "turnSince ignores the author's own skill report" '"2026-10-22T00:00:00Z"' "$(json_field 62 .turnSince)"
assert_eq "turnSince ignores the author's own clean-review comment" '"2026-10-01T00:00:00Z"' "$(json_field 61 .turnSince)"
assert_eq "turnSince ignores threads the author opened, open or resolved" '"2026-10-22T05:00:00Z"' \
  "$(json_field 65 .turnSince)"
assert_eq "--json lists the codeowners, lowercased" '["andy","luis"]' "$(jq -c .codeowners "$tmp_dir/board.json")"
assert_eq "--json marks approval" "true" "$(json_field 9 .approved)"

printf '* @luis @F3-Nation/admins\n' >"$tmp_dir/TEAM_CODEOWNERS"
team_err=$(PR_TRIAGE_CODEOWNERS="$tmp_dir/TEAM_CODEOWNERS" run_triage --json 2>&1 >/dev/null)
status=$?
assert_eq "an @org/team codeowner fails the run" "1" "$status"
assert_eq "an @org/team codeowner is named" "1" "$(grep -c 'names the team @f3-nation/admins' <<<"$team_err")"
PR_TRIAGE_CODEOWNERS="$tmp_dir/missing" run_triage --json >/dev/null 2>&1
assert_eq "a missing CODEOWNERS file fails the run" "1" "$?"
run_triage --json --html >/dev/null 2>&1
assert_eq "--json and --html together are rejected" "1" "$?"

run_triage >"$tmp_dir/text.out" 2>&1
status=$?
assert_eq "text mode exits 0" "0" "$status"
assert_eq "text mode lists /pr-local-test PRs first" "Run /pr-local-test" "$(sed -n 3p "$tmp_dir/text.out")"
assert_eq "text mode shows the empty-note url on its own line" \
  "         https://github.com/acme/repo/pull/5" \
  "$(grep -A2 '#5 ' "$tmp_dir/text.out" | tail -1)"
assert_eq "text mode shows Unassigned when a PR has no assignee" "         Assignee: Unassigned" \
  "$(grep -A1 '#5 ' "$tmp_dir/text.out" | tail -1)"
assert_eq "text mode lists every assignee" "         Assignee: amy, cy" \
  "$(grep -A1 '#7 ' "$tmp_dir/text.out" | tail -1)"
assert_eq "text mode keeps a multiline title's card on one line" \
  "  #16    first line second line (someone)" "$(grep '#16 ' "$tmp_dir/text.out")"
assert_eq "text mode lists PRs waiting on a reviewer's reply" "1" \
  "$(grep -c "^Waiting on a reviewer's reply$" "$tmp_dir/text.out")"
assert_eq "the board has a column for PRs waiting on a reviewer's reply" "1" \
  "$(grep -c '\["REPLY", "Waiting on a reviewer' "$tmp_dir/board.html")"
assert_eq "text mode counts drafts" "3 drafts ignored; skipped (Renovate/release-please): #2 #32 " \
  "$(tail -1 "$tmp_dir/text.out")"

ledger="$tmp_dir/ledger.tsv"
printf 'acme/repo\t5\tpr-review-inline\tsha\t2026-10-22T00:00:00Z\nacme/repo\t64\tpr-review-inline\tsha\t2026-10-22T00:00:00Z\tmark\n' >"$ledger"
PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$ledger" \
  bash "$triage" -R acme/repo --out "$tmp_dir/ledger.html" --no-open >/dev/null 2>&1
ledger_bucket() {
  sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/ledger.html" | sed '1d;$d' \
    | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .bucket'
}
assert_eq "a local ledger entry counts as a run" "LOCAL" "$(ledger_bucket 5)"
assert_eq "the ledger doesn't count runs on the viewer's own PR" "INLINE" "$(ledger_bucket 64)"

# Paging: a fake gh serves page 2 when asked for the cursor page 1 returned.
stub_dir="$tmp_dir/stub"
mkdir -p "$stub_dir"
jq '.data.repository.pullRequests |= (.pageInfo = {hasNextPage: true, endCursor: "c1"}
  | .nodes = [.nodes[] | select(.number == 5)])' "$tmp_dir/fixture.json" >"$stub_dir/page1.json"
jq '.data.repository.pullRequests |= (.pageInfo = {hasNextPage: false, endCursor: null}
  | .nodes = [.nodes[] | select(.number == 8)])' "$tmp_dir/fixture.json" >"$stub_dir/page2.json"
cat >"$stub_dir/gh" <<STUB
#!/usr/bin/env bash
case "\$*" in
  "auth status") exit 0 ;;
  *cursor=c1*) cat "$stub_dir/page2.json" ;;
  *) cat "$stub_dir/page1.json" ;;
esac
STUB
chmod +x "$stub_dir/gh"

run_paged() {
  PATH="$stub_dir:$PATH" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
    bash "$triage" -R acme/repo --out "$tmp_dir/paged.html" --no-open >/dev/null 2>&1
  sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/paged.html" | sed '1d;$d'
}
paged=$(run_paged)
assert_eq "every page of open PRs is fetched" "5 8" "$(jq -r '[.prs[].number] | join(" ")' <<<"$paged")"
assert_eq "a complete fetch isn't marked cut off" "false" "$(jq -r .truncated <<<"$paged")"
paged=$(PR_TRIAGE_MAX_PAGES=1 run_paged)
assert_eq "the page cap stops fetching" "5" "$(jq -r '[.prs[].number] | join(" ")' <<<"$paged")"
assert_eq "a capped fetch is marked cut off" "true 1" "$(jq -r '"\(.truncated) \(.fetched)"' <<<"$paged")"

# GitHub failing every read of reviewDecision: the page is fetched again without it, and an
# approved PR falls back to needing approval. A fallback that also fails still fails the run.
decision_stub="$tmp_dir/decision-stub"
mkdir -p "$decision_stub"
jq '.data.repository.pullRequests |= (.pageInfo = {hasNextPage: false, endCursor: null}
  | .nodes = [.nodes[] | select(.number == 8 or .number == 9) | del(.reviewDecision)])' \
  "$tmp_dir/fixture.json" >"$decision_stub/page.json"
cat >"$decision_stub/gh" <<STUB
#!/usr/bin/env bash
case "\$*" in
  "auth status") exit 0 ;;
  *reviewDecision*) echo "gh: Something went wrong" >&2; exit 1 ;;
  *) [[ -n "\${DECISION_STUB_FAIL_ALL:-}" ]] && exit 1; cat "$decision_stub/page.json" ;;
esac
STUB
chmod +x "$decision_stub/gh"
# sleep is stubbed so the retry doesn't slow the suite.
printf '#!/usr/bin/env bash\nexit 0\n' >"$decision_stub/sleep"
chmod +x "$decision_stub/sleep"
mkdir -p "$decision_stub/sleep-only"
cp "$decision_stub/sleep" "$decision_stub/sleep-only/sleep"

run_decision() {
  PATH="$decision_stub:$PATH" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
    bash "$triage" -R acme/repo --json 2>"$tmp_dir/decision.err"
}
decision_out=$(run_decision)
status=$?
assert_eq "a failing reviewDecision falls back and exits 0" "0" "$status"
assert_eq "without a review decision an approved PR needs approval" "MANUAL MANUAL" \
  "$(jq -r '[.prs[] | select(.number == 8 or .number == 9) | .bucket] | join(" ")' <<<"$decision_out")"
assert_eq "the fallback is reported" "1" "$(grep -c 'without review decisions' "$tmp_dir/decision.err")"
assert_eq "the fallback is marked on the board" "true" "$(jq -r .reviewDecisionsMissing <<<"$decision_out")"
assert_eq "a board without a fallback has no such mark" "false" "$(jq 'has("reviewDecisionsMissing")' "$tmp_dir/board.json")"
decision_text=$(PATH="$decision_stub:$PATH" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
  NO_COLOR=1 bash "$triage" -R acme/repo 2>/dev/null)
assert_eq "the text board says approvals couldn't be read" "1" \
  "$(grep -c "GitHub couldn't read approvals for some PRs" <<<"$decision_text")"
assert_eq "the text board without a fallback doesn't" "0" \
  "$(grep -c "couldn't read approvals" "$tmp_dir/text.out")"
DECISION_STUB_FAIL_ALL=1 run_decision >/dev/null
status=$?
assert_eq "a fallback that also fails exits non-zero" "true" "$([[ $status -ne 0 ]] && echo true || echo false)"

# Sourcing the script returns with a hint instead of exiting the caller's shell.
sourced_err=$(bash -c '. "$1" --json; echo "status=$?"' _ "$triage" 2>&1)
assert_eq "sourcing the script returns 1 instead of exiting" "status=1" "$(echo "$sourced_err" | tail -1)"
assert_eq "sourcing the script says how to run it" "1" "$(echo "$sourced_err" | grep -c 'not with')"

# A response with no PR data reports GitHub's own errors.
echo '{"data":null,"errors":[{"message":"boom"}]}' >"$tmp_dir/errors.json"
err_out=$(PR_TRIAGE_FIXTURE="$tmp_dir/errors.json" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
  bash "$triage" -R acme/repo 2>&1)
status=$?
assert_eq "an errors-only response exits 1" "1" "$status"
assert_eq "an errors-only response reports GitHub's message" "pr-triage: GitHub response had no pull request data" \
  "$(echo "$err_out" | head -1 | cut -c1-51)"
assert_eq "an errors-only response includes the error text" "1" "$(echo "$err_out" | grep -c boom)"

# One bad ledger row is skipped, not fatal.
bad_ledger="$tmp_dir/bad-ledger.tsv"
printf 'acme/repo\tabc\tpr-review-inline\nacme/repo\t5\tpr-review-inline\tsha\t2026-10-22T00:00:00Z\n' >"$bad_ledger"
PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$bad_ledger" \
  bash "$triage" -R acme/repo --out "$tmp_dir/bad.html" --no-open >/dev/null 2>"$tmp_dir/bad.err"
status=$?
assert_eq "a malformed ledger row doesn't fail the run" "0" "$status"
assert_eq "a malformed ledger row is reported" "pr-triage: ignoring malformed lines in $bad_ledger" \
  "$(cat "$tmp_dir/bad.err")"
assert_eq "the valid ledger row is still honored" "LOCAL" \
  "$(sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/bad.html" | sed '1d;$d' \
    | jq -r '.prs[] | select(.number == 5) | .bucket')"

# mark: a fake gh supplies the head SHA; the ledger it writes must be readable by the reader.
mark_stub="$tmp_dir/mark-stub"
mkdir -p "$mark_stub"
cat >"$mark_stub/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "auth status") exit 0 ;;
  *headRefOid*) echo deadbeef ;;
esac
STUB
chmod +x "$mark_stub/gh"
mark_ledger="$tmp_dir/new-dir/ledger.tsv"
run_mark() { PATH="$mark_stub:$PATH" PR_TRIAGE_LEDGER="$mark_ledger" bash "$triage" -R acme/repo mark "$@"; }
run_mark 5 inline >/dev/null 2>&1
run_mark 8 local >/dev/null 2>&1
assert_eq "mark writes one line per run" "2" "$(wc -l <"$mark_ledger" | tr -d ' ')"
assert_eq "mark writes six tab-separated fields, tagged as a mark" "6:mark 6:mark" \
  "$(awk -F'\t' '{printf "%s%s:%s", sep, NF, $6; sep=" "}' "$mark_ledger")"
assert_eq "mark maps the kinds to skills" "pr-review-inline pr-local-test" \
  "$(awk -F'\t' '{printf "%s%s", sep, $3; sep=" "}' "$mark_ledger")"
PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$mark_ledger" \
  bash "$triage" -R acme/repo --out "$tmp_dir/marked.html" --no-open >/dev/null 2>&1
marked_bucket() {
  sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/marked.html" | sed '1d;$d' \
    | jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .bucket'
}
assert_eq "a marked PR moves past /pr-review-inline" "LOCAL" "$(marked_bucket 5)"
assert_eq "an already-finished PR is unchanged by mark" "MANUAL" "$(marked_bucket 8)"
run_mark abc inline >/dev/null 2>&1
assert_eq "mark rejects a non-numeric PR" "1" "$?"
run_mark 5 bogus >/dev/null 2>&1
assert_eq "mark rejects an unknown kind" "1" "$?"
run_mark 12 inline -R other/repo >/dev/null 2>&1
assert_eq "mark rejects options after the subcommand" "1" "$?"
assert_eq "a rejected mark writes nothing" "2" "$(wc -l <"$mark_ledger" | tr -d ' ')"

# PR 29's blocked report was posted at 02:00. Only a later hand-recorded mark clears it.
bucket_with_ledger() {
  printf '%s\n' "$1" >"$tmp_dir/override.tsv"
  # A failed run must not leave the previous case's board to be read.
  rm -f "$tmp_dir/override.html"
  PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$tmp_dir/override.tsv" \
    bash "$triage" -R acme/repo --out "$tmp_dir/override.html" --no-open >/dev/null 2>&1 \
    || { echo "pr-triage failed"; return; }
  sed -n '/id="data">/,/<\/script>/p' "$tmp_dir/override.html" | sed '1d;$d' \
    | jq -r '.prs[] | select(.number == 29) | .bucket'
}
assert_eq "a later mark clears a blocked local test" "MANUAL" \
  "$(bucket_with_ledger "$(printf 'acme/repo\t29\tpr-local-test\tsha\t2026-10-22T03:00:00Z\tmark')")"
assert_eq "the skill's own later ledger line doesn't clear it" "LOCAL" \
  "$(bucket_with_ledger "$(printf 'acme/repo\t29\tpr-local-test\tsha\t2026-10-22T03:00:00Z')")"
assert_eq "a mark from before the blocked report doesn't clear it" "LOCAL" \
  "$(bucket_with_ledger "$(printf 'acme/repo\t29\tpr-local-test\tsha\t2026-10-22T01:00:00Z\tmark')")"

# --with-advisories: a fake gh answers the advisory list as $ADV_MODE says, and each fork's PRs.
adv_dir="$tmp_dir/adv"
mkdir -p "$adv_dir/bin"
fork_a="acme/repo-ghsa-aaaa-bbbb-cccc" fork_b="acme/repo-ghsa-dddd-eeee-ffff"
# A fork's PRs carry latestOpinionatedReviews in place of reviewDecision, as the fork query asks.
fork_board() {
  jq --arg url "https://github.com/$1/pull/" --argjson numbers "$2" \
    '.data.repository.pullRequests.nodes |= [.[] | select(.number | IN($numbers[]))
      | del(.reviewDecision) | .latestOpinionatedReviews = {nodes: []}
      | .url = $url + (.number | tostring)]' "$tmp_dir/fixture.json"
}
fork_board "$fork_a" '[5, 8]' >"$adv_dir/fork-a.json"
fork_board "$fork_b" '[5]' >"$adv_dir/fork-b.json"
echo '{"data":null,"errors":[{"message":"Could not resolve to a Repository"}]}' >"$adv_dir/fork-c.json"
fork_board acme/repo-ghsa-vvvv-wwww-xxxx '[]' >"$adv_dir/fork-d.json"
# A fork whose only open PR is a draft.
fork_board acme/repo-ghsa-yyyy-zzzz-2222 '[1]' >"$adv_dir/fork-e.json"
advisory() { jq -nc --arg id "$1" --arg severity "$2" --arg fork "$3" --arg at "$4" --arg summary "${5:-Summary of $1}" \
  '{ghsa_id: $id, severity: (if $severity == "" then null else $severity end), created_at: $at,
    summary: $summary, private_fork: (if $fork == "" then null else {full_name: $fork} end)}'; }
{
  echo "["
  advisory GHSA-dddd-eeee-ffff critical "$fork_b" 2026-10-02T00:00:00Z; echo ","
  advisory GHSA-aaaa-bbbb-cccc high "$fork_a" 2026-10-01T00:00:00Z; echo ","
  # Read again in the draft state with a fork: the later record wins.
  advisory GHSA-gggg-hhhh-jjjj low "" 2026-10-03T00:00:00Z
  echo "]"
} >"$adv_dir/triage.json"
{
  echo "["
  # Read again in the second state: it is kept once.
  advisory GHSA-aaaa-bbbb-cccc high "$fork_a" 2026-10-01T00:00:00Z; echo ","
  advisory GHSA-gggg-hhhh-jjjj low acme/repo-ghsa-gggg-hhhh-jjjj 2026-10-03T00:00:00Z; echo ","
  # A fork not named <repo>-<its GHSA ID>, a malformed ID and an advisory without a fork.
  advisory GHSA-kkkk-mmmm-nnnn high evil/repo-ghsa-kkkk-mmmm-nnnn 2026-10-04T00:00:00Z; echo ","
  advisory GHSA-pppp-qqqq-rrrr high acme/repo-ghsa-kkkk-mmmm-nnnn 2026-10-04T00:00:00Z; echo ","
  advisory GHSA-bad high acme/repo-ghsa-bad 2026-10-04T00:00:00Z; echo ","
  advisory GHSA-ssss-tttt-uuuu medium "" 2026-10-05T00:00:00Z \
    "$(printf '</script><b>x</b>\nsecond\037\302\233line')"; echo ","
  advisory GHSA-vvvv-wwww-xxxx low acme/repo-ghsa-vvvv-wwww-xxxx 2026-10-06T00:00:00Z; echo ","
  advisory GHSA-yyyy-zzzz-2222 high acme/repo-ghsa-yyyy-zzzz-2222 2026-10-07T00:00:00Z
  echo "]"
} >"$adv_dir/draft.json"
cat >"$adv_dir/bin/gh" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == "auth status" ]] && exit 0
# GitHub can fail the whole query when it computes reviewDecision on an advisory fork's PR.
if [[ "$*" == *name=repo-ghsa-* && "$*" == *reviewDecision* ]]; then
  echo "gh: Something went wrong while executing your query." >&2
  exit 1
fi
if [[ "$1 $2" == "api --paginate" ]]; then
  case "$ADV_MODE" in
    notfound) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
    servererror) echo "gh: Server Error (HTTP 502)" >&2; exit 1 ;;
    forbidden) echo '{"message":"Resource not accessible by integration"}'
      echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1 ;;
    empty) echo '[]' ;;
    unexpected) echo '{"message":"not a list"}' ;;
    list) case "$3" in
        *state=triage*) cat "$ADV_DIR/triage.json" ;;
        *) cat "$ADV_DIR/draft.json" ;;
      esac ;;
  esac
  exit 0
fi
case "$*" in
  *latestOpinionatedReviews*name=repo-ghsa-aaaa-bbbb-cccc*)
    if [[ -n "${ADV_FORK_A_NO_DECISION:-}" ]]; then exit 1; fi
    cat "$ADV_DIR/fork-a.json" ;;
  *name=repo-ghsa-aaaa-bbbb-cccc*) cat "$ADV_DIR/fork-a.json" ;;
  *name=repo-ghsa-dddd-eeee-ffff*) cat "$ADV_DIR/fork-b.json" ;;
  *name=repo-ghsa-gggg-hhhh-jjjj*) cat "$ADV_DIR/fork-c.json" ;;
  *name=repo-ghsa-vvvv-wwww-xxxx*) cat "$ADV_DIR/fork-d.json" ;;
  *name=repo-ghsa-yyyy-zzzz-2222*) cat "$ADV_DIR/fork-e.json" ;;
  *name=repo-ghsa-hhhh-jjjj-kkkk*) cat "$ADV_DIR/fork-f.json" ;;
  *) echo "gh: unexpected call: $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$adv_dir/bin/gh"

run_adv() {
  local mode="$1"
  shift
  ADV_MODE="$mode" ADV_DIR="$adv_dir" PATH="$adv_dir/bin:$PATH" \
    PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" \
    PR_TRIAGE_LEDGER="${ADV_LEDGER:-$tmp_dir/no-ledger.tsv}" NO_COLOR=1 \
    bash "$triage" -R acme/repo --with-advisories "$@"
}

# Anyone GitHub shows no advisories gets exactly the board they'd get without the flag.
for mode in notfound forbidden empty; do
  run_adv "$mode" >"$adv_dir/$mode.text" 2>"$adv_dir/$mode.err"
  status=$?
  run_adv "$mode" --json >"$adv_dir/$mode.json" 2>>"$adv_dir/$mode.err"
  status=$((status + $?))
  run_adv "$mode" --out "$adv_dir/$mode.html" --no-open >/dev/null 2>>"$adv_dir/$mode.err"
  status=$((status + $?))
  assert_eq "advisories $mode: every run exits 0" "0" "$status"
  assert_eq "advisories $mode: nothing is said about it" "" "$(cat "$adv_dir/$mode.err")"
  if cmp -s "$tmp_dir/text.out" "$adv_dir/$mode.text" && cmp -s "$tmp_dir/board.json" "$adv_dir/$mode.json" \
    && cmp -s "$tmp_dir/board.html" "$adv_dir/$mode.html"; then same=yes; else same=no; fi
  assert_eq "advisories $mode: text, JSON and HTML match a run without the flag" "yes" "$same"
done

# Any other failed read is said, on stderr and on the board.
for mode in servererror unexpected; do
  run_adv "$mode" --json >"$adv_dir/$mode.json" 2>"$adv_dir/$mode.err"
  assert_eq "advisories $mode: the run exits 0" "0" "$?"
  assert_eq "advisories $mode: stderr says the advisories couldn't be read" \
    "pr-triage: Couldn't read the security advisories, so advisory PRs may be missing." "$(cat "$adv_dir/$mode.err")"
  assert_eq "advisories $mode: the board notes it" \
    '["Couldn'"'"'t read the security advisories, so advisory PRs may be missing."]' \
    "$(jq -c .advisoryNotes "$adv_dir/$mode.json")"
  assert_eq "advisories $mode: the repo's own PRs are unchanged" "$(jq -c .prs "$tmp_dir/board.json")" \
    "$(jq -c .prs "$adv_dir/$mode.json")"
done

run_adv list --json >"$adv_dir/list.json" 2>"$adv_dir/list.err"
status=$?
assert_eq "advisories: the run exits 0" "0" "$status"
assert_eq "advisories: nothing goes to stderr" "" "$(cat "$adv_dir/list.err")"
adv() { jq -c "$1" "$adv_dir/list.json"; }
assert_eq "advisories: only forks read are counted" "4" "$(adv .advisoryForks)"
assert_eq "advisories: a fork that couldn't be read is noted" \
  '["Couldn'"'"'t read 1 security advisory fork, so its PRs aren'"'"'t shown."]' "$(adv .advisoryNotes)"
assert_eq "advisories: fix PRs come first, most severe first, each with its ref" \
  '["GHSA-dddd-eeee-ffff #5","GHSA-aaaa-bbbb-cccc #5","GHSA-aaaa-bbbb-cccc #8","GHSA-yyyy-zzzz-2222 #1",null]' \
  "$(adv '[.prs[0:5][] | .ref]')"
assert_eq "advisories: those without a fix PR are listed, most severe first" \
  '["GHSA-yyyy-zzzz-2222","GHSA-ssss-tttt-uuuu","GHSA-vvvv-wwww-xxxx"]' \
  "$(adv '[.advisoriesWithoutPr[].ghsa]')"
assert_eq "advisories: only a draft-only fork is marked as having a draft" "[true,false,false]" \
  "$(adv '[.advisoriesWithoutPr[].draftPr]')"
assert_eq "advisories: an advisory without a fix PR carries its details" \
  '{"ghsa":"GHSA-vvvv-wwww-xxxx","severity":"low","summary":"Summary of GHSA-vvvv-wwww-xxxx","createdAt":"2026-10-06T00:00:00Z","url":"https://github.com/acme/repo/security/advisories/GHSA-vvvv-wwww-xxxx","draftPr":false}' \
  "$(adv '.advisoriesWithoutPr[2]')"
assert_eq "advisories: an advisory read in both states keeps its later record's fork" "[]" \
  "$(adv '[.advisoriesWithoutPr[] | select(.ghsa == "GHSA-gggg-hhhh-jjjj")]')"
assert_eq "advisories: a summary's control characters, C1 included, become spaces" "</script><b>x</b> second line" \
  "$(adv '.advisoriesWithoutPr[1].summary' | jq -r .)"
assert_eq "advisories: a fix PR carries its advisory" \
  '{"ghsa":"GHSA-aaaa-bbbb-cccc","severity":"high","url":"https://github.com/acme/repo/security/advisories/GHSA-aaaa-bbbb-cccc"}' \
  "$(adv '.prs[] | select(.ref == "GHSA-aaaa-bbbb-cccc #5") | .advisory')"
assert_eq "advisories: a fix PR is triaged like any other" "MANUAL" \
  "$(adv '.prs[] | select(.ref == "GHSA-aaaa-bbbb-cccc #8") | .bucket' | tr -d '"')"
assert_eq "advisories: the repo's own PRs are unchanged" "$(jq -c .prs "$tmp_dir/board.json")" \
  "$(adv '[.prs[] | select(.advisory == null)]')"
assert_eq "advisories: no fallback leaves no approvals mark" "false" "$(adv 'has("reviewDecisionsMissing")')"

# A fork read that only succeeds without review decisions still marks the board, though the
# fork's warning goes to a discarded stderr. sleep is stubbed so the retry doesn't slow the suite.
ADV_FORK_A_NO_DECISION=1 PATH="$decision_stub/sleep-only:$PATH" run_adv list --json \
  >"$adv_dir/no-decision.json" 2>/dev/null
assert_eq "advisories: a fork's fallback exits 0" "0" "$?"
assert_eq "advisories: a fork's fallback is marked on the board" "true" \
  "$(jq -r .reviewDecisionsMissing "$adv_dir/no-decision.json")"
assert_eq "advisories: a fork read through the fallback is still shown" \
  '["GHSA-aaaa-bbbb-cccc #5","GHSA-aaaa-bbbb-cccc #8"]' \
  "$(jq -c '[.prs[] | select(.advisory.ghsa == "GHSA-aaaa-bbbb-cccc") | .ref]' "$adv_dir/no-decision.json")"

# A draft-only fork whose PRs were cut off may have a fix PR past the cut, so it isn't listed.
cut_dir="$tmp_dir/adv-cut"
cp -R "$adv_dir" "$cut_dir"
jq '.data.repository.pullRequests.pageInfo = {hasNextPage: true, endCursor: "c1"}' \
  "$adv_dir/fork-e.json" >"$cut_dir/fork-e.json"
cut_board=$(ADV_MODE=list ADV_DIR="$cut_dir" PATH="$adv_dir/bin:$PATH" PR_TRIAGE_MAX_PAGES=1 \
  PR_TRIAGE_FIXTURE="$tmp_dir/fixture.json" PR_TRIAGE_NOW="$now" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
  bash "$triage" -R acme/repo --with-advisories --json 2>/dev/null)
assert_eq "advisories: a cut-off fork isn't listed as without a fix PR" \
  '["GHSA-ssss-tttt-uuuu","GHSA-vvvv-wwww-xxxx"]' "$(jq -c '[.advisoriesWithoutPr[].ghsa]' <<<"$cut_board")"
assert_eq "advisories: a cut-off fork is noted" "1 security advisory fork has more open PRs: only the oldest are shown." \
  "$(jq -r '.advisoryNotes[1]' <<<"$cut_board")"

# A fork PR's approval comes from its latest opinionated reviews, the way main's ruleset reads
# them: an approval of the head commit by an owner of every path, and no outstanding change
# request. Only luis is on every CODEOWNERS line; andy owns only the `*` rule.
jq --arg url "https://github.com/acme/repo-ghsa-hhhh-jjjj-kkkk/pull/" '
  def opinion($by; $state; $oid): {state: $state, author: {login: $by}, commit: {oid: $oid}};
  .data.repository.pullRequests.nodes |= ([.[] | select(.number == 8)][0] as $done
    | [($done | .number = 41 | .latestOpinionatedReviews.nodes = [opinion("Luis"; "APPROVED"; "first")]),
       ($done | .number = 42 | .latestOpinionatedReviews.nodes =
         [opinion("luis"; "APPROVED"; "first"), opinion("andy"; "CHANGES_REQUESTED"; "first")]),
       ($done | .number = 43 | .latestOpinionatedReviews.nodes = [opinion("luis"; "APPROVED"; "older")]),
       ($done | .number = 44 | .latestOpinionatedReviews.nodes = [opinion("not-an-owner"; "APPROVED"; "first")]),
       ($done | .number = 45 | .latestOpinionatedReviews.nodes = []),
       ($done | .number = 46 | .author.login = "luis"
         | .latestOpinionatedReviews.nodes = [opinion("luis"; "APPROVED"; "first")]),
       ($done | .number = 47 | .latestOpinionatedReviews.nodes = [opinion("andy"; "APPROVED"; "first")]),
       ($done | .number = 48 | .latestOpinionatedReviews =
         {pageInfo: {hasNextPage: true}, nodes: [opinion("luis"; "APPROVED"; "first")]})]
    | map(del(.reviewDecision) | .url = $url + (.number | tostring)))' \
  "$tmp_dir/fixture.json" >"$adv_dir/fork-f.json"
fork_only=$(ADV_MODE=list ADV_DIR="$adv_dir" PATH="$adv_dir/bin:$PATH" PR_TRIAGE_NOW="$now" \
  PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" bash "$triage" -R acme/repo-ghsa-hhhh-jjjj-kkkk --json 2>&1)
assert_eq "a fork read on its own never asks for reviewDecision" "41,42,43,44,45,46,47,48" \
  "$(jq -r '[.prs[].number] | join(",")' <<<"$fork_only" 2>/dev/null)"
fork_bucket() { jq -r --argjson n "$1" '.prs[] | select(.number == $n) | .bucket' <<<"$fork_only" 2>/dev/null; }
assert_eq "fork: a codeowner's approval of the head waits to merge" "MERGE" "$(fork_bucket 41)"
assert_eq "fork: an outstanding change request outweighs an approval" "MANUAL" "$(fork_bucket 42)"
assert_eq "fork: an approval of an older commit doesn't count" "MANUAL" "$(fork_bucket 43)"
assert_eq "fork: a non-codeowner's approval doesn't count" "MANUAL" "$(fork_bucket 44)"
assert_eq "fork: no opinionated review needs approval" "MANUAL" "$(fork_bucket 45)"
assert_eq "fork: the author's own approval doesn't count" "MANUAL" "$(fork_bucket 46)"
assert_eq "fork: an approval from an owner of only some paths doesn't count" "MANUAL" "$(fork_bucket 47)"
assert_eq "fork: a cut-off review list doesn't count as approved" "MANUAL" "$(fork_bucket 48)"

# An early exit waits for a slow fork read instead of leaving it writing into a removed work_dir.
slow_dir="$tmp_dir/adv-slow"
mkdir -p "$slow_dir/bin" "$slow_dir/tmp"
echo '{"data":null}' >"$slow_dir/no-prs.json"
cat >"$slow_dir/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [[ "$1 $2" == "api --paginate" ]]; then
  case "$3" in
    *state=triage*) printf '[{"ghsa_id":"GHSA-aaaa-bbbb-cccc","private_fork":{"full_name":"acme/repo-ghsa-aaaa-bbbb-cccc"}}]' ;;
    *) echo '[]' ;;
  esac
  exit 0
fi
sleep 1
cat "$ADV_DIR/fork-a.json"
: >"$SLOW_DONE"
STUB
chmod +x "$slow_dir/bin/gh"
ADV_DIR="$adv_dir" SLOW_DONE="$slow_dir/fork-read" PATH="$slow_dir/bin:$PATH" TMPDIR="$slow_dir/tmp" \
  PR_TRIAGE_FIXTURE="$slow_dir/no-prs.json" PR_TRIAGE_LEDGER="$tmp_dir/no-ledger.tsv" \
  bash "$triage" -R acme/repo --with-advisories --json >/dev/null 2>&1
assert_eq "advisories: an early exit waits for the fork reads" "yes" \
  "$([[ -f "$slow_dir/fork-read" ]] && echo yes || echo no)"
assert_eq "advisories: an early exit leaves no work directory behind" "" "$(ls -A "$slow_dir/tmp")"

printf '%s\t5\tpr-review-inline\tsha\t2026-10-22T00:00:00Z\n' "$fork_a" >"$adv_dir/ledger.tsv"
ADV_LEDGER="$adv_dir/ledger.tsv" run_adv list --json >"$adv_dir/ledger.json" 2>/dev/null
ledger_buckets=$(jq -r '[.prs[] | select(.number == 5) | "\(.ref // "repo"):\(.bucket)"] | join(" ")' \
  "$adv_dir/ledger.json")
assert_eq "advisories: a ledger row counts only on its own fork's PR" \
  "GHSA-dddd-eeee-ffff #5:INLINE GHSA-aaaa-bbbb-cccc #5:LOCAL repo:INLINE" "$ledger_buckets"

run_adv list >"$adv_dir/list.text" 2>/dev/null
assert_eq "advisories: the text header says how many forks are included" \
  "PR triage for acme/repo (as @viewer; includes 4 security advisory forks)" "$(head -1 "$adv_dir/list.text")"
assert_eq "advisories: the text lists advisories without a fix PR first" \
  "Security advisories without a fix PR" "$(sed -n 4p "$adv_dir/list.text")"
assert_eq "advisories: an advisory without a fix PR shows its severity, age and draft" \
  "  GHSA-yyyy-zzzz-2222 [high] Summary of GHSA-yyyy-zzzz-2222|         opened 15d ago; draft fix PR open" \
  "$(sed -n '5,6p' "$adv_dir/list.text" | paste -sd'|' -)"
assert_eq "advisories: a hostile summary stays on one line" \
  "  GHSA-ssss-tttt-uuuu [medium] </script><b>x</b> second line" "$(grep '^  GHSA-ssss' "$adv_dir/list.text")"
assert_eq "advisories: the text lists the unread-fork note" \
  "  Couldn't read 1 security advisory fork, so its PRs aren't shown." "$(sed -n 2p "$adv_dir/list.text")"
assert_eq "advisories: a fix PR's card names its advisory and severity" \
  "  #5 [GHSA-dddd-eeee-ffff · critical] fresh (someone)" \
  "$(grep -m1 'GHSA-dddd' "$adv_dir/list.text")"

# The board is readable only by you, even over an older board anyone could read.
printf 'old\n' >"$adv_dir/list.html"
chmod 644 "$adv_dir/list.html"
# A second name for the older board's file, so -ef can tell whether the new board reused it.
ln "$adv_dir/list.html" "$adv_dir/old-board"
run_adv list --out "$adv_dir/list.html" --no-open >/dev/null 2>&1
assert_eq "advisories: the HTML board replaces an older board's file instead of reusing it" "no" \
  "$([[ "$adv_dir/list.html" -ef "$adv_dir/old-board" ]] && echo yes || echo no)"
assert_eq "advisories: no temporary board is left beside it" "" \
  "$(find "$adv_dir" -maxdepth 1 -name '.pr-triage.*')"
assert_eq "advisories: the HTML board is readable only by its owner" "$adv_dir/list.html" \
  "$(find "$adv_dir/list.html" -perm 0600)"
assert_eq "advisories: the HTML board holds the fix PRs and the advisories without one" "4 3" \
  "$(sed -n '/id="data">/,/<\/script>/p' "$adv_dir/list.html" | sed '1d;$d' \
    | jq -r '"\([.prs[] | select(.advisory)] | length) \(.advisoriesWithoutPr | length)"')"
assert_eq "advisories: a hostile summary can't close the HTML data block" "0" \
  "$(grep -c '</script><b>' "$adv_dir/list.html")"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} pr-triage test(s) failed"
  exit 1
fi
echo "All pr-triage tests passed"
