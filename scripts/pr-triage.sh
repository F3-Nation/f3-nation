#!/usr/bin/env bash
# pr-triage: sort a repo's open PRs by what a codeowner should do next.
#
#   scripts/pr-triage.sh [-R owner/repo] [--with-advisories] [--html [--out FILE] [--no-open] | --json]
#   scripts/pr-triage.sh [-R owner/repo] mark <PR> inline|local
#
#   -R, --repo         repository to triage (default: F3-Nation/f3-nation)
#   --with-advisories  also triage the fix PRs in the repo's open security advisories you can see
#   --html             write a single-page board instead of terminal text, and open it
#   --out FILE         where to write the board (default: $TMPDIR/pr-triage-<owner>-<repo>.html)
#   --no-open          write the board without opening it
#   --json             print the board's data as JSON (what the Codeowners PR Report reads)
#   mark               record a skill run by hand in your local ledger; for an advisory fix PR,
#                      pass its fork as -R
#
# Needs gh (signed in with `gh auth login`) and jq. Runs on macOS, Linux and WSL.
#
# --with-advisories lists the open (triage or draft) security advisories your gh login can see
# and triages the PRs in each one's temporary private fork beside the repo's own, advisory PRs
# first, most severe first. Anyone GitHub shows no advisories gets the same board as without the
# flag, with no message: a failed or refused advisory read is treated as none. Only once an
# advisory is visible does the board note a fork it couldn't read. The Codeowners PR Report never
# passes the flag, so advisory PRs stay out of its public Slack post.
#
# Stages, in order:
#   draft                                         -> ignored
#   Renovate / release-please author              -> skipped
#   pr-review-inline not run                      -> needs /pr-review-inline
#   last local test ❌, no push since             -> waiting on unresolved threads (the author's push)
#   every unresolved thread ends with the author  -> waiting on a reviewer's reply
#   any other unresolved review thread            -> waiting on unresolved threads
#   pr-local-test not run, or last run ⏸️ or ❌     -> needs /pr-local-test
#   otherwise, your own PR                        -> your PRs (nothing left for you to do)
#   otherwise, approved                           -> approved, waiting to merge
#   otherwise                                     -> needs codeowner review and approval
#
# Only a codeowner's skill run moves a PR: the union of @user handles in .github/CODEOWNERS
# ($PR_TRIAGE_CODEOWNERS overrides the file), compared case-insensitively. An @org/team entry
# is an error. The PR author's own runs never count, so a codeowner can check their own PR
# without it looking reviewed. A run is detected by its hidden marker, or by your local ledger
# ($PR_TRIAGE_LEDGER, default ${XDG_STATE_HOME:-~/.local/state}/pr-triage/ledger.tsv), which
# counts on every PR but your own. The <!-- pr-review-inline --> marker is read in PR comments and inline review
# comments; the <!-- pr-local-test --> marker in review bodies and inline review comments. Runs
# from before the markers existed are recognized by the shape of their comments.
#
# A local-test report that is ⏸️ (can't recommend yet) or ❌ (don't approve yet) keeps the PR
# waiting on /pr-local-test until a later run passes, a codeowner adds the `local test: not
# needed` label after it, or you `mark` a run after it. A ❌ first waits on the author's push.
# That label also stands in for a local test that never ran.
set -euo pipefail

LEDGER="${PR_TRIAGE_LEDGER:-${XDG_STATE_HOME:-$HOME/.local/state}/pr-triage/ledger.tsv}"
LEGACY_CUTOFF="2026-10-21T00:00:00Z"
# Each PR pulls hundreds of comments and reviews; at 50 PRs a page GitHub's ~10s GraphQL
# limit returns HTTP 504, while 10 PRs answer in about 3s. 50 pages still covers 500 PRs.
PAGE_SIZE=10
MAX_PAGES="${PR_TRIAGE_MAX_PAGES:-50}"
SEP=$'\x1f'
NOT_NEEDED_LABEL="local test: not needed"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEOWNERS_FILE="${PR_TRIAGE_CODEOWNERS:-$script_dir/../.github/CODEOWNERS}"

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "pr-triage: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"; }

repo="F3-Nation/f3-nation" html=false json=false out="" open_board=true with_advisories=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -R | --repo) [[ $# -ge 2 ]] || usage 1; repo="$2"; shift 2 ;;
    --html) html=true; shift ;;
    --out) [[ $# -ge 2 ]] || usage 1; out="$2"; html=true; shift 2 ;;
    --no-open) open_board=false; shift ;;
    --json) json=true; shift ;;
    --with-advisories) with_advisories=true; shift ;;
    -h | --help) usage 0 ;;
    mark) break ;;
    *) usage 1 ;;
  esac
done
[[ "$repo" == */* ]] || die "--repo must look like owner/name"
if $json && $html; then usage 1; fi

need jq "Install it with 'brew install jq' (macOS) or 'sudo apt-get install jq' (Linux/WSL)."
if [[ -z "${PR_TRIAGE_FIXTURE:-}" ]]; then
  need gh "Install it from https://cli.github.com, then run 'gh auth login'."
  gh auth status >/dev/null 2>&1 || die "gh isn't signed in. Run 'gh auth login' first."
fi

if [[ "${1:-}" == "mark" ]]; then
  # Options go before `mark`; anything after <PR> and the kind (like a stray -R) is an error.
  [[ $# -eq 3 ]] || usage 1
  pr="${2:-}" kind="${3:-}"
  [[ "$pr" =~ ^[0-9]+$ ]] || usage 1
  case "$kind" in
    inline) skill="pr-review-inline" ;;
    local) skill="pr-local-test" ;;
    *) usage 1 ;;
  esac
  sha=$(gh pr view "$pr" -R "$repo" --json headRefOid -q .headRefOid)
  mkdir -p "$(dirname "$LEDGER")"
  # The sixth field tells a hand-recorded run apart from the line each skill writes for itself.
  printf '%s\t%s\t%s\t%s\t%s\tmark\n' "$repo" "$pr" "$skill" "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >>"$LEDGER"
  echo "Recorded $skill for $repo#$pr in $LEDGER"
  exit 0
fi

# Every @handle on an ownership line, lowercased; `#` starts a comment anywhere on a line.
[[ -f "$CODEOWNERS_FILE" ]] || die "can't read codeowners from $CODEOWNERS_FILE"
codeowners=$(awk '{ for (i = 1; i <= NF; i++) { if ($i ~ /^#/) break; if ($i ~ /^@/) print tolower(substr($i, 2)) } }' \
  "$CODEOWNERS_FILE" | sort -u)
team=$(grep / <<<"$codeowners" | head -1 || true)
[[ -z "$team" ]] || die "$CODEOWNERS_FILE names the team @$team; list each codeowner's own @handle instead"
[[ -n "$codeowners" ]] || die "$CODEOWNERS_FILE lists no @handles"
codeowners_json=$(jq -R -s -c 'split("\n") | map(select(length > 0))' <<<"$codeowners")

# shellcheck disable=SC2016
query='
query($owner: String!, $name: String!, $cursor: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: '"$PAGE_SIZE"', after: $cursor,
                 orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt reviewDecision mergeable authorAssociation
        author { login __typename }
        assignees(first: 10) { nodes { login } }
        labels(first: 30) { nodes { name } }
        timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
        labelEvents: timelineItems(last: 20, itemTypes: [LABELED_EVENT]) {
          nodes { ... on LabeledEvent { createdAt actor { login } label { name } } }
        }
        reopened: timelineItems(last: 1, itemTypes: [REOPENED_EVENT]) {
          nodes { ... on ReopenedEvent { createdAt } }
        }
        commits(last: 1) {
          nodes { commit { oid committedDate } }
        }
        # Both ends of each list: a skill marker may be among the oldest or the newest.
        comments(last: 100) { ...comments }
        firstComments: comments(first: 100) { ...comments }
        reviews(last: 100) { ...reviews }
        firstReviews: reviews(first: 100) { ...reviews }
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            isResolved
            comments(first: 1) { nodes { author { login } } }
            lastComment: comments(last: 1) { nodes { author { login } createdAt } }
          }
        }
      }
    }
  }
}
fragment comments on IssueCommentConnection {
  nodes { author { login __typename } body createdAt }
}
fragment reviews on PullRequestReviewConnection {
  nodes {
    author { login __typename } body submittedAt commit { oid }
    comments(first: 5) { nodes { author { login __typename } body replyTo { id } } }
  }
}'

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/pr-triage.XXXXXX")
advisory_pid=""
cleanup() {
  [[ -z "$advisory_pid" ]] || kill "$advisory_pid" 2>/dev/null || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

# Every page of a repo's open PRs into <file>: every page's PRs under the last page's pageInfo,
# so hasNextPage still marks a cut-off list.
fetch_prs() {
  local target="$1" file="$2" dir cursor="" page=0 page_file
  local -a args
  dir=$(mktemp -d "$work_dir/pages.XXXXXX") || return 1
  while :; do
    page=$((page + 1))
    args=(-f query="$query" -f owner="${target%%/*}" -f name="${target#*/}")
    if [[ -n "$cursor" ]]; then args+=(-f cursor="$cursor"); fi
    page_file="$dir/$(printf '%03d' "$page").json"
    if ! gh api graphql "${args[@]}" >"$page_file"; then
      # A busy GitHub occasionally answers 502 or 504; one retry usually succeeds.
      sleep 2
      gh api graphql "${args[@]}" >"$page_file" || return 1
    fi
    [[ "$(jq -r '.data.repository.pullRequests.pageInfo.hasNextPage' "$page_file")" == "true" ]] || break
    (( page < MAX_PAGES )) || break
    cursor=$(jq -r '.data.repository.pullRequests.pageInfo.endCursor' "$page_file") || return 1
  done
  jq -s '(map(.data.repository.pullRequests.nodes) | add) as $all
    | last | .data.repository.pullRequests.nodes = $all' "$dir"/*.json >"$file"
}

# The open advisories the viewer can see, most severe then oldest first, one line each of
# GHSA ID, severity ("" if unset) and fork, split on \x1f. Only an advisory whose fork GitHub
# names exactly <repo>-ghsa-… is kept. Fails on any refused or unexpected answer.
list_advisories() {
  local state listed=""
  for state in triage draft; do
    listed+="$(gh api --paginate "repos/$repo/security-advisories?state=$state&per_page=100")" || return 1
    listed+=$'\n'
  done
  # shellcheck disable=SC2016
  jq -rs --arg repo "$repo" '
    def rank: . as $s | ["critical", "high", "medium", "low"] | index($s) // 4;
    if all(.[]; type == "array") then add // [] else error("not a list of advisories") end
    | map({ghsa: (.ghsa_id // ""), severity: (.severity // ""), fork: (.private_fork.full_name // ""),
            createdAt: (.created_at // "")})
    | map(select((.ghsa | test("^GHSA(-[a-z0-9]{4}){3}$"))
        and (.fork | ascii_downcase) == ("\($repo)-\(.ghsa)" | ascii_downcase)))
    | map(.severity |= (if IN("critical", "high", "medium", "low") then . else "" end))
    | unique_by(.ghsa)
    | sort_by((.severity | rank), .createdAt)
    | .[] | [.ghsa, .severity, .fork] | join("\u001f")' <<<"$listed"
}

# Run in the background beside the repo's own fetch: the advisory list into advisories.tsv,
# then each fork's PRs into fork-<n>.json, with fork-<n>.ok once read, a few forks at a time.
# Every failure leaves its file out and says nothing.
discover_advisories() {
  local list n=0 fork
  list=$(list_advisories) || return 0
  [[ -n "$list" ]] || return 0
  printf '%s\n' "$list" >"$work_dir/advisories.tsv"
  while IFS="$SEP" read -r _ _ fork; do
    n=$((n + 1))
    { fetch_prs "$fork" "$work_dir/fork-$n.json" && : >"$work_dir/fork-$n.ok"; } &
    if (( n % 4 == 0 )); then wait; fi
  done <<<"$list"
  wait
}

if $with_advisories && command -v gh >/dev/null 2>&1; then
  ( set +e; discover_advisories ) </dev/null >/dev/null 2>&1 &
  advisory_pid=$!
fi

if [[ -n "${PR_TRIAGE_FIXTURE:-}" ]]; then
  data_file="$PR_TRIAGE_FIXTURE"
else
  data_file="$work_dir/base.json"
  fetch_prs "$repo" "$data_file" || exit 1
fi

# Every valid ledger row, with its repo: each board reads only its own repo's rows.
ledger_json="[]"
if [[ -f "$LEDGER" ]]; then
  ledger_json=$(jq -R -s '
    [split("\n")[] | select(length > 0) | split("\t")] as $rows
    | [$rows[] | select(length >= 3 and (.[1] | test("^[0-9]+$")))] as $valid
    | {bad: (($rows | length) - ($valid | length)),
       rows: [$valid[]
         | {repo: .[0], pr: (.[1] | tonumber), skill: .[2], at: .[4], manual: (.[5] == "mark")}]}' "$LEDGER")
  [[ "$(jq '.bad' <<<"$ledger_json")" == "0" ]] || echo "pr-triage: ignoring malformed lines in $LEDGER" >&2
  ledger_json=$(jq -c '.rows' <<<"$ledger_json")
fi

# shellcheck disable=SC2016
classify='
  def footer: test("_written by |— _Claude Code_");
  def ts: if . == null then 0 else fromdateiso8601 end;
  def has_marker($m): (. // "") | contains("<!-- \($m) -->");
  def lower_login: (. // "") | ascii_downcase;
  ($codeowners | map({key: ., value: true}) | from_entries) as $owners
  | def codeowner: $owners[lower_login] == true;
  # Only a codeowner'"'"'s run moves a PR; anyone else'"'"'s is extra input. That also leaves out
  # review bots, which quote the markers back in their own comments.
  def owner_marker($m): (.author.login | codeowner) and (.body | has_marker($m));
  # The PR author'"'"'s own run is a self-check, not a review: the PR still needs another
  # codeowner, so it stays where it was.
  def not_by($author): (.author.login | lower_login) != ($author | lower_login);
  def actor_not($author): (.actor.login | lower_login) != ($author | lower_login);
  def reviewer_marker($m; $author): owner_marker($m) and not_by($author);

  ($now // now) as $now
  | .data.viewer.login as $me
  | .data.repository.pullRequests as $prs
  | {
    repo: $repo,
    viewer: $me,
    codeowners: $codeowners,
    generatedAt: ($now | todate),
    truncated: $prs.pageInfo.hasNextPage,
    fetched: ($prs.nodes | length),
    prs: [$prs.nodes[]
      # On a PR with under 100 of either, both ends hold the same items; any() tolerates that.
      | .comments.nodes += (.firstComments.nodes // [])
      | .reviews.nodes += (.firstReviews.nodes // [])
      | . as $pr
      | ($pr.author.login // "ghost") as $author
      | ($pr.commits.nodes[0].commit) as $head
      | ($pr.timelineItems.nodes[0].createdAt) as $readyAt

      # Skill runs, by codeowners other than the author or in the local ledger. The ledger holds
      # the viewer'"'"'s own runs, so on a PR the viewer wrote, every row is a self-check.
      | (if ($author | lower_login) == ($me | lower_login) then []
         else $ledger | map(select(.repo == $repo and .pr == $pr.number)) end) as $ledgerRows
      | ($ledgerRows | map(.skill)) as $logged
      | [$pr.reviews.nodes[] | select((.submittedAt | ts) < ($cutoff | ts))
          | select((.author.login | codeowner) and not_by($author))] as $legacy
      | [$pr.reviews.nodes[] | select(reviewer_marker("pr-local-test"; $author)
          or any(.comments.nodes[]; reviewer_marker("pr-local-test"; $author)))] as $localReports
      | (($logged | index("pr-local-test") != null)
          or ($localReports | length) > 0
          or any($legacy[]; (.body // "") as $b | ($b | footer) and ($b | contains("|"))))
        as $localRan
      # A report that could not recommend yet (⏸️, its main check was blocked) or found a
      # problem (❌) holds the PR until something after it clears it.
      # "." stands for the apostrophe, straight or curly.
      | ([$pr.reviews.nodes[] | select(reviewer_marker("pr-local-test"; $author))]
          | sort_by(.submittedAt // "") | last) as $lastLocal
      | ($lastLocal.body // "") as $lastLocalBody
      | ($lastLocalBody | test("Can.t recommend yet")) as $localBlocked
      | ($lastLocalBody | test("Needs changes before approval|Don.t approve yet")) as $localFailed
      | ($lastLocal.submittedAt | ts) as $lastLocalAt
      # Only a hand-recorded `mark` made after that report clears it: the skill logs every run,
      # held ones included, just after posting the report.
      | ([$ledgerRows[] | select(.manual and .skill == "pr-local-test") | .at | try ts catch 0]
          | max // 0) as $markedLocalAt
      # The label counts while it is on the PR, from its newest add, and only when a codeowner
      # other than the PR'"'"'s author made that add. An add older than the events fetched does
      # not count.
      | (any($pr.labels.nodes[]?; .name == $notNeededLabel)) as $hasNotNeeded
      | ([$pr.labelEvents.nodes[]? | select(.label.name == $notNeededLabel)]
          | max_by(.createdAt | ts)
          | if . != null and (.actor.login | codeowner) and actor_not($author) then .createdAt | ts else 0 end)
        as $notNeededAt
      | ($hasNotNeeded and $notNeededAt > 0 and ($lastLocal == null or $notNeededAt > $lastLocalAt))
        as $notNeededClears
      | (($localBlocked or $localFailed) and ($markedLocalAt <= $lastLocalAt)) as $localHeld
      # A ❌ asks the author for changes, so until they push it is their turn. Each review records
      # the commit it was made on; a commit date can predate the push that delivers it.
      | ($localHeld and $localFailed and ($notNeededClears | not)
          and $lastLocal.commit.oid != null and $lastLocal.commit.oid == $head.oid) as $awaitingFixes
      | (($localRan and ($localHeld | not)) or $notNeededClears) as $localTested
      # A clean inline review leaves only a "no issues" comment, and a local test always follows one.
      | [$pr.comments.nodes[] | select(reviewer_marker("pr-review-inline"; $author))] as $inlineNotes
      | ($localRan
          or ($logged | index("pr-review-inline") != null)
          or ($inlineNotes | length) > 0
          or any($pr.reviews.nodes[]; any(.comments.nodes[]; reviewer_marker("pr-review-inline"; $author)))
          or any($legacy[]; (.body // "") == "" and any(.comments.nodes[];
               .replyTo == null and (.body | footer) and (.body | has_marker("pr-local-test") | not))))
        as $inlineReviewed

      # Threads
      | [$pr.reviewThreads.nodes[] | select(.isResolved | not)] as $openThreads
      | [$openThreads[] | (.comments.nodes[0].author.login // "ghost")] as $open
      | ($open | group_by(.) | map("\(.[0]) \(length)") | join(", ")) as $openBy
      # Past the first 100 threads none can be checked, so the PR waits rather than advancing.
      | ($pr.reviewThreads.pageInfo.hasNextPage // false) as $moreThreads
      # The same turn rule as the author nudge: a thread whose last comment is the author'"'"'s
      # waits on a reviewer.
      | (($open | length) > 0 and ($moreThreads | not)
          and all($openThreads[]; (.lastComment.nodes[0].author.login // "") == $author))
        as $allReplied
      | ($pr.reviewDecision == "APPROVED") as $approved
      | ($pr.mergeable == "CONFLICTING") as $conflicts

      | (if $pr.isDraft then ["DRAFT", ""]
         elif ($author | test("^(app/)?(renovate|release-please)(\\[bot\\])?$"))
           or ($pr.author.__typename == "Bot" and ($author | test("renovate|release-please")))
           then ["SKIP", ""]
         elif ($inlineReviewed | not) then ["INLINE", ""]
         elif $allReplied and ($awaitingFixes | not) then ["REPLY", "\($open | length) unresolved, author replied (\($openBy))"]
         elif ($open | length) > 0 or $moreThreads then ["THREADS",
           (if ($open | length) > 0 then "\($open | length) unresolved (\($openBy))" else "" end)
           + (if $moreThreads then "; over 100 threads, check the rest on GitHub" else "" end)
           + (if $awaitingFixes then "; local test asked for changes; waiting on a push" else "" end)
           + (if $localTested then "; both skills done" else "" end) | ltrimstr("; ")]
         elif $awaitingFixes then ["THREADS", "local test asked for changes; waiting on a push"]
         elif ($localTested | not) then
           ["LOCAL", (if $localHeld and $localFailed then "last local test said don'"'"'t approve yet"
                      elif $localHeld then "last local test could not recommend yet"
                      else "" end)]
         elif $author == $me then
           ["OWN", (if $approved then "approved" else "needs another approver" end)]
         elif $approved then ["MERGE", ""]
         else ["MANUAL", ""]
         end) as $verdict
      | ($verdict[0] | IN("DRAFT", "SKIP") | not) as $active
      | [$pr.assignees.nodes[]?.login] as $assignees
      | [$pr.reviewThreads.nodes[] | select((.comments.nodes[0].author.login // "") != $author)]
        as $othersThreads

      # When the PR last became the codeowners'"'"' turn: the newest of the PR opening, being
      # reopened or marked ready, a codeowner'"'"'s skill report, a thread closing, and the
      # author'"'"'s last push or thread reply. A thread the author opened is their own note,
      # often a self-check finding, so it counts for neither. Approximate: the push is the head
      # commit'"'"'s own date (when it was made, not pushed), and GitHub keeps no time for
      # resolving a thread, so a resolved thread counts from its last comment. Both can make
      # turnSince early, never late.
      | ([$pr.createdAt, $readyAt, $pr.reopened.nodes[0].createdAt, $head.committedDate,
          ($localReports[] | .submittedAt),
          ($inlineNotes[] | .createdAt),
          ($pr.reviews.nodes[] | select(any(.comments.nodes[]; reviewer_marker("pr-review-inline"; $author)))
            | .submittedAt),
          ($othersThreads[] | select(.isResolved) | .lastComment.nodes[0].createdAt),
          ($othersThreads[] | .lastComment.nodes[0]
            | select(.author.login == $author) | .createdAt)]
        | map(ts) | max) as $turnSince
      | {
          bucket: $verdict[0],
          number: $pr.number,
          # Newlines would split a card across lines in the terminal listing.
          title: ($pr.title | gsub("[\\r\\n]+"; " ")),
          author: $author,
          authorAssociation: ($pr.authorAssociation // "NONE"),
          authorIsCodeowner: ($author | codeowner),
          assignee: ($assignees | join(", ") | if . == "" then "Unassigned" else . end),
          assignees: $assignees,
          codeownerAssignees: [$assignees[] | select(codeowner and (lower_login != ($author | lower_login)))],
          unresolvedThreads: ($open | length),
          threadOpeners: ($open | unique),
          approved: $approved,
          turnSince: ($turnSince | todate),
          url: $pr.url,
          mine: ($author == $me),
          assignedToMe: ($assignees | index($me) != null),
          note: ([
            (if $verdict[1] != "" then $verdict[1] else empty end),
            (if $conflicts and $active then "merge conflicts" else empty end)
          ] | join("; "))
        }
        # Every fork numbers its PRs from 1; the advisory ID tells them apart.
        + (if $advisory == null then {}
           else {advisory: $advisory, ref: "\($advisory.ghsa) #\($pr.number)"} end)
    ]
  }'

# One repo's board from its fetched PRs; <advisory> is null for the repo itself.
classify_board() {
  jq --arg repo "$2" --arg cutoff "$LEGACY_CUTOFF" --arg notNeededLabel "$NOT_NEEDED_LABEL" \
    --argjson codeowners "$codeowners_json" --argjson ledger "$ledger_json" \
    --argjson advisory "$3" --argjson now "${PR_TRIAGE_NOW:-null}" "$classify" "$1"
}

jq -e '.data.repository.pullRequests.nodes' "$data_file" >/dev/null 2>&1 \
  || die "GitHub response had no pull request data for $repo: $(jq -c '.errors // .' "$data_file" | head -c 300)"
board=$(classify_board "$data_file" "$repo" null) || die "could not classify PRs for $repo"

if [[ -n "$advisory_pid" ]]; then
  wait "$advisory_pid" || true
  advisory_pid=""
fi
# Each fork read becomes a board of its own; the advisory PRs go first, in the list's order.
if [[ -s "$work_dir/advisories.tsv" ]]; then
  n=0 unread=0
  fork_boards=()
  while IFS="$SEP" read -r ghsa severity fork; do
    n=$((n + 1))
    fork_data="$work_dir/fork-$n.json" fork_board="$work_dir/board-$(printf '%03d' "$n").json"
    advisory=$(jq -nc --arg ghsa "$ghsa" --arg severity "$severity" --arg repo "$repo" \
      '{ghsa: $ghsa, severity: (if $severity == "" then null else $severity end),
        url: "https://github.com/\($repo)/security/advisories/\($ghsa)"}')
    if [[ -f "$work_dir/fork-$n.ok" ]] \
      && jq -e '.data.repository.pullRequests.nodes' "$fork_data" >/dev/null 2>&1 \
      && classify_board "$fork_data" "$fork" "$advisory" >"$fork_board" 2>/dev/null; then
      fork_boards+=("$fork_board")
    else
      unread=$((unread + 1))
    fi
  done <"$work_dir/advisories.tsv"
  (( ${#fork_boards[@]} > 0 )) || fork_boards=(/dev/null)
  # shellcheck disable=SC2016
  board=$(jq -s --argjson base "$board" --argjson unread "$unread" '
    def forks($n): "\($n) security advisory fork\(if $n == 1 then "" else "s" end)";
    . as $forks
    | ([$forks[] | select(.truncated)] | length) as $cut
    | $base
    | .prs = ([$forks[].prs[]] + .prs)
    | .advisoryForks = ($forks | length)
    | ([if $unread > 0 then "Couldn'"'"'t read \(forks($unread)), so \(if $unread == 1 then "its" else "their" end) PRs aren'"'"'t shown." else empty end,
        if $cut > 0 then "\(forks($cut)) \(if $cut == 1 then "has" else "have" end) more open PRs: only the oldest are shown." else empty end])
      as $notes
    | if ($notes | length) > 0 then .advisoryNotes = $notes else . end' "${fork_boards[@]}") \
    || die "could not merge the security advisory PRs"
fi

if $json; then
  printf '%s\n' "$board"
  exit 0
fi

open_file() {
  local file="$1"
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if command -v wslview >/dev/null 2>&1; then
      wslview "$file"
    else
      # explorer.exe exits non-zero even when it opens the file.
      explorer.exe "$(wslpath -w "$file")" || true
    fi
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    open "$file"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$file" >/dev/null 2>&1
  else
    return 1
  fi
}

if $html; then
  [[ -n "$out" ]] || out="${TMPDIR:-/tmp}"
  [[ -d "$out" ]] && out="${out%/}/pr-triage-${repo%%/*}-${repo#*/}.html"
  # "<" is escaped so no PR title can close the <script> block it is embedded in.
  json=$(jq -c '.' <<<"$board" | sed 's/</\\u003c/g')
  # Only you can read the board: it can name unfixed security advisories. Truncating first and
  # then narrowing the mode keeps an older board's wider mode from applying to the new content.
  umask 077
  : >"$out"
  chmod 600 "$out"
  {
    cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR triage</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #eceef2; --card: #ffffff; --text: #1d2330; --muted: #5d6677;
    --border: #d9dde5; --link: #1f5fbf; --chip: #e7ecf6; --chip-text: #2d4a80;
    --warn: #8a5300; --warn-bg: #fff3dc; --adv: #a3202a; --adv-bg: #fde4e4;
    --c-inline: #6f5cc4; --c-threads: #c27c1a; --c-local: #2f86b5;
    --c-reply: #b5577d; --c-manual: #2f9b62; --c-merge: #1f7a4a; --c-own: #7a8494;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --panel: #1a1e26; --card: #222833; --text: #e5e8ee; --muted: #9aa3b2;
      --border: #313948; --link: #7fb0ff; --chip: #26324a; --chip-text: #b7cbf2;
      --warn: #ffc56b; --warn-bg: #3a2d14; --adv: #ffb3b3; --adv-bg: #4a1d22;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { padding: 20px 16px 8px; max-width: 1800px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; }
  .meta code { background: var(--panel); padding: 1px 5px; border-radius: 4px; }
  .notice { margin-top: 10px; padding: 8px 12px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .filters button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .filters button[aria-pressed="true"] { background: var(--chip); color: var(--chip-text);
    border-color: var(--chip-text); font-weight: 600; }
  main { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 1fr);
    gap: 12px; padding: 12px 16px 16px; max-width: 1800px; margin: 0 auto;
    overflow-x: auto; align-items: start; }
  .col { background: var(--panel); border-radius: 8px; border-top: 4px solid var(--accent);
    padding: 10px; min-width: 0; }
  .col h2 { font-size: 14px; margin: 0; display: flex; justify-content: space-between; gap: 8px; }
  .count { color: var(--muted); font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; margin: 4px 0 10px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; margin-bottom: 8px; }
  .card a { color: var(--link); text-decoration: none; }
  .card a:hover { text-decoration: underline; }
  .num { font-weight: 600; margin-right: 4px; }
  .title { overflow-wrap: anywhere; }
  .by { color: var(--muted); font-size: 12px; margin-top: 4px; display: flex; gap: 6px;
    flex-wrap: wrap; align-items: center; }
  .chip { background: var(--chip); color: var(--chip-text); border-radius: 10px; padding: 0 7px;
    font-size: 11px; font-weight: 600; }
  .card a.advisory { background: var(--adv-bg); color: var(--adv); }
  .note { font-size: 12px; margin-top: 4px; color: var(--muted); overflow-wrap: anywhere; }
  .empty { color: var(--muted); font-size: 12px; font-style: italic; }
  footer { color: var(--muted); font-size: 12px; padding: 0 16px 24px; max-width: 1800px; margin: 0 auto; }
  @media (max-width: 700px) {
    main { grid-auto-flow: row; grid-auto-columns: auto; overflow-x: visible; }
  }
</style>
</head>
<body>
<header>
  <h1 id="heading">PR triage</h1>
  <div class="meta" id="meta"></div>
  <div class="filters" id="filters" role="group" aria-label="Filter by assignee"></div>
</header>
<main id="board"></main>
<footer id="footer"></footer>
<script type="application/json" id="data">
HTML
    printf '%s\n' "$json"
    cat <<'HTML'
</script>
<script>
  const data = JSON.parse(document.getElementById("data").textContent);
  const columns = [
    ["INLINE", "Needs /pr-review-inline", "Run the pr-review-inline skill on these.", "--c-inline"],
    ["THREADS", "Waiting on unresolved threads",
      "The author needs to address or reply to open review threads, or push the fixes a local test asked for.", "--c-threads"],
    ["REPLY", "Waiting on a reviewer's reply",
      "The author replied in every open thread. Its reviewer answers or resolves it.", "--c-reply"],
    ["LOCAL", "Needs /pr-local-test", "Threads are resolved. Run the pr-local-test skill on these.", "--c-local"],
    ["MANUAL", "Needs codeowner approval", "Both skills are done. Review and approve.", "--c-manual"],
    ["MERGE", "Approved, waiting to merge", "Approved and ready to merge.", "--c-merge"],
    ["OWN", "Your PRs: your steps are done", "Someone else needs to approve these.", "--c-own"],
  ];
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const link = (href, cls, text) => {
    const a = el("a", cls, text);
    if (/^https:\/\/github\.com\//.test(href)) a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };

  document.getElementById("heading").textContent = `PR triage · ${data.repo}`;
  document.title = `PR triage · ${data.repo}`;
  const meta = document.getElementById("meta");
  meta.append(`Generated ${new Date(data.generatedAt).toLocaleString()} for @${data.viewer}. Rerun `);
  const rerun = data.advisoryForks === undefined
    ? "scripts/pr-triage.sh --html" : "scripts/pr-triage.sh --with-advisories --html";
  meta.append(el("code", "", rerun), " to refresh.");
  if (data.advisoryForks) {
    const forks = data.advisoryForks;
    meta.append(` Includes ${forks} security advisory fork${forks === 1 ? "" : "s"}.`);
  }
  for (const note of data.advisoryNotes ?? []) {
    document.querySelector("header").append(el("div", "notice", note));
  }
  if (data.truncated) {
    document.querySelector("header").append(
      el("div", "notice", `There are more open PRs: only the oldest ${data.fetched} are shown.`));
  }

  const board = document.getElementById("board");
  const render = (keep) => {
    board.replaceChildren();
    for (const [bucket, name, hint, accent] of columns) {
      const prs = data.prs.filter((pr) => pr.bucket === bucket && keep(pr));
      const col = el("section", "col");
      col.style.setProperty("--accent", `var(${accent})`);
      const h2 = el("h2");
      h2.append(el("span", "", name), el("span", "count", String(prs.length)));
      col.append(h2, el("div", "hint", hint));
      if (prs.length === 0) col.append(el("div", "empty", "Nothing here."));
      for (const pr of prs) {
        const card = el("article", "card");
        const head = el("div", "title");
        head.append(link(pr.url, "num", `#${pr.number}`), link(pr.url, "", pr.title));
        const by = el("div", "by");
        by.append(el("span", "", `@${pr.author}`));
        if (pr.advisory) {
          const severity = pr.advisory.severity ? ` · ${pr.advisory.severity}` : "";
          by.append(link(pr.advisory.url, "chip advisory", `${pr.advisory.ghsa}${severity}`));
        }
        if (pr.mine && bucket !== "OWN") by.append(el("span", "chip", "yours"));
        const assignee = el("div", "by",
          pr.assignee === "Unassigned" ? "Unassigned" : `Assigned: ${pr.assignee}`);
        card.append(head, by, assignee);
        if (pr.note) card.append(el("div", "note", pr.note));
        col.append(card);
      }
      board.append(col);
    }
  };

  const filters = [
    ["all", "All", () => true],
    ["mine", "Assigned to me", (pr) => pr.assignedToMe],
    ["unassigned", "Unassigned", (pr) => pr.assignee === "Unassigned"],
  ];
  // Drafts and skipped PRs have no column, so they'd inflate the counts on the buttons.
  const shown = data.prs.filter((pr) => columns.some(([bucket]) => bucket === pr.bucket));
  const filterBar = document.getElementById("filters");
  for (const [key, label, keep] of filters) {
    const button = el("button", "", `${label} (${shown.filter(keep).length})`);
    button.type = "button";
    button.dataset.filter = key;
    button.setAttribute("aria-pressed", String(key === "all"));
    button.addEventListener("click", () => {
      for (const other of filterBar.children) {
        other.setAttribute("aria-pressed", String(other === button));
      }
      render(keep);
    });
    filterBar.append(button);
  }
  render(() => true);

  const drafts = data.prs.filter((pr) => pr.bucket === "DRAFT").length;
  const skipped = data.prs.filter((pr) => pr.bucket === "SKIP").map((pr) => pr.ref ?? `#${pr.number}`);
  document.getElementById("footer").textContent =
    `${drafts} draft${drafts === 1 ? "" : "s"} ignored. ` +
    `Skipped (Renovate and release-please): ${skipped.join(" ") || "none"}.`;
</script>
</body>
</html>
HTML
  } >"$out"
  echo "Wrote $out"
  if $open_board; then
    open_file "$out" || echo "Open it in your browser to view the board."
  fi
  exit 0
fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  bold=$'\e[1m' dim=$'\e[2m' reset=$'\e[0m'
else
  bold="" dim="" reset=""
fi

# Fields are split on \x1f, not tab: `read` collapses runs of whitespace separators, so an
# empty note would shift the url left. An advisory fix PR's number carries its advisory.
rows=$(jq -r '.prs[] | [.bucket,
    (if .advisory then "\(.number) [\(.advisory.ghsa)\(if .advisory.severity then " · \(.advisory.severity)" else "" end)]"
     else .number | tostring end),
    (.title | gsub("\u001f"; " ")), .author, .assignee, .note, .url]
  | join("\u001f")' <<<"$board")

section() {
  local bucket="$1" heading="$2" matches
  matches=$(awk -F"$SEP" -v b="$bucket" '$1 == b' <<<"$rows")
  [[ -n "$matches" ]] || return 0
  printf '\n%s%s%s\n' "$bold" "$heading" "$reset"
  while IFS="$SEP" read -r _ num title author assignee note url; do
    (( ${#title} > 70 )) && title="${title:0:67}..."
    printf '  #%-5s %s %s(%s)%s\n' "$num" "$title" "$dim" "$author" "$reset"
    printf '         %sAssignee: %s%s\n' "$dim" "$assignee" "$reset"
    [[ -n "$note" ]] && printf '         %s\n' "$note"
    printf '         %s%s%s\n' "$dim" "$url" "$reset"
  done <<<"$matches"
}

viewer=$(jq -r '.viewer' <<<"$board")
advisory_forks=$(jq -r '.advisoryForks // 0' <<<"$board")
case "$advisory_forks" in
  0) including="" ;;
  1) including="; includes 1 security advisory fork" ;;
  *) including="; includes $advisory_forks security advisory forks" ;;
esac
echo "${bold}PR triage for $repo${reset} ${dim}(as @$viewer$including)${reset}"
jq -r '.advisoryNotes // [] | .[] | "  \(.)"' <<<"$board"
if [[ "$(jq -r '.truncated' <<<"$board")" == "true" ]]; then
  echo "  There are more open PRs; only the oldest $(jq -r '.fetched' <<<"$board") are shown"
fi
section LOCAL "Run /pr-local-test"
section INLINE "Run /pr-review-inline"
section MANUAL "Both skills done: waiting on codeowner review and approval"
section MERGE "Approved: waiting to merge"
section REPLY "Waiting on a reviewer's reply"
section THREADS "Waiting on unresolved threads"
section OWN "Your PRs: your steps are done"
drafts=$(awk -F"$SEP" '$1 == "DRAFT"' <<<"$rows" | grep -c . || true)
skipped=$(awk -F"$SEP" '$1 == "SKIP" { printf "#%s ", $2 }' <<<"$rows")
printf '\n%s%s drafts ignored; skipped (Renovate/release-please): %s%s\n' "$dim" "$drafts" "${skipped:-none}" "$reset"
