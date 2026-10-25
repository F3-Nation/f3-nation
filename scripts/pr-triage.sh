#!/usr/bin/env bash
# pr-triage: sort a repo's open PRs by what a codeowner should do next.
#
#   scripts/pr-triage.sh [-R owner/repo] [--html [--out FILE] [--no-open]]
#   scripts/pr-triage.sh [-R owner/repo] mark <PR> inline|local
#
#   -R, --repo    repository to triage (default: F3-Nation/f3-nation)
#   --html        write a single-page board instead of terminal text, and open it
#   --out FILE    where to write the board (default: $TMPDIR/pr-triage-<owner>-<repo>.html)
#   --no-open     write the board without opening it
#   mark          record a skill run by hand in your local ledger
#
# Needs gh (signed in with `gh auth login`) and jq. Runs on macOS, Linux and WSL.
#
# Stages, in order:
#   draft                                         -> ignored
#   Renovate / release-please author              -> skipped
#   CodeRabbit, Greptile, or Qodo not finished    -> waiting on AI bots (gives up after 2h)
#   pr-review-inline not run                      -> needs /pr-review-inline
#   any unresolved review thread                  -> waiting on unresolved threads
#   pr-local-test not run                         -> needs /pr-local-test
#   otherwise, your own PR                        -> your PRs (nothing left for you to do)
#   otherwise, approved                           -> approved, waiting to merge
#   otherwise                                     -> needs codeowner review and approval
#
# A skill run, by anyone but a bot, is detected by its hidden marker, or by your local ledger
# ($PR_TRIAGE_LEDGER, default ${XDG_STATE_HOME:-~/.local/state}/pr-triage/ledger.tsv). The
# <!-- pr-review-inline --> marker is read in PR comments and inline review comments; the
# <!-- pr-local-test --> marker in review bodies and inline review comments. Runs from before
# the markers existed are recognized by the shape of their comments.
set -euo pipefail

BOT_TIMEOUT_SECS="${PR_TRIAGE_BOT_TIMEOUT_SECS:-7200}"
LEDGER="${PR_TRIAGE_LEDGER:-${XDG_STATE_HOME:-$HOME/.local/state}/pr-triage/ledger.tsv}"
LEGACY_CUTOFF="2026-10-21T00:00:00Z"
# Each PR pulls hundreds of comments and reviews; at 50 PRs a page GitHub's ~10s GraphQL
# limit returns HTTP 504, while 10 PRs answer in about 3s. 50 pages still covers 500 PRs.
PAGE_SIZE=10
MAX_PAGES="${PR_TRIAGE_MAX_PAGES:-50}"
SEP=$'\x1f'

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "pr-triage: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"; }

repo="F3-Nation/f3-nation" html=false out="" open_board=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    -R | --repo) [[ $# -ge 2 ]] || usage 1; repo="$2"; shift 2 ;;
    --html) html=true; shift ;;
    --out) [[ $# -ge 2 ]] || usage 1; out="$2"; html=true; shift 2 ;;
    --no-open) open_board=false; shift ;;
    -h | --help) usage 0 ;;
    mark) break ;;
    *) usage 1 ;;
  esac
done
[[ "$repo" == */* ]] || die "--repo must look like owner/name"

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

# shellcheck disable=SC2016
query='
query($owner: String!, $name: String!, $cursor: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: '"$PAGE_SIZE"', after: $cursor,
                 orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt reviewDecision mergeable
        author { login __typename }
        timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
        commits(last: 1) {
          nodes { commit { committedDate statusCheckRollup { contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name status startedAt }
            ... on StatusContext { context state description createdAt }
          } } } } }
        }
        # Both ends of each list: a skill marker may be among the oldest or the newest.
        comments(last: 100) { ...comments }
        firstComments: comments(first: 100) { ...comments }
        reviews(last: 100) { ...reviews }
        firstReviews: reviews(first: 100) { ...reviews }
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes { isResolved comments(first: 1) { nodes { author { login } } } }
        }
      }
    }
  }
}
fragment comments on IssueCommentConnection {
  nodes { author { login __typename } body }
}
fragment reviews on PullRequestReviewConnection {
  nodes {
    author { login __typename } body submittedAt
    comments(first: 5) { nodes { author { login __typename } body replyTo { id } } }
  }
}'

if [[ -n "${PR_TRIAGE_FIXTURE:-}" ]]; then
  data=$(cat "$PR_TRIAGE_FIXTURE")
else
  pages_dir=$(mktemp -d "${TMPDIR:-/tmp}/pr-triage.XXXXXX")
  trap 'rm -rf "$pages_dir"' EXIT
  cursor="" page=0
  while :; do
    page=$((page + 1))
    args=(-f query="$query" -f owner="${repo%%/*}" -f name="${repo#*/}")
    [[ -n "$cursor" ]] && args+=(-f cursor="$cursor")
    page_file="$pages_dir/$(printf '%03d' "$page").json"
    if ! gh api graphql "${args[@]}" >"$page_file"; then
      # A busy GitHub occasionally answers 502 or 504; one retry usually succeeds.
      sleep 2
      gh api graphql "${args[@]}" >"$page_file"
    fi
    [[ "$(jq -r '.data.repository.pullRequests.pageInfo.hasNextPage' "$page_file")" == "true" ]] || break
    (( page < MAX_PAGES )) || break
    cursor=$(jq -r '.data.repository.pullRequests.pageInfo.endCursor' "$page_file")
  done
  # Every page's PRs under the last page's pageInfo, so hasNextPage still marks a cut-off list.
  data=$(jq -s '(map(.data.repository.pullRequests.nodes) | add) as $all
    | last | .data.repository.pullRequests.nodes = $all' "$pages_dir"/*.json)
fi

ledger_json="[]"
if [[ -f "$LEDGER" ]]; then
  ledger_json=$(jq -R -s --arg repo "$repo" '
    [split("\n")[] | select(length > 0) | split("\t")] as $rows
    | [$rows[] | select(length >= 3 and (.[1] | test("^[0-9]+$")))] as $valid
    | {bad: (($rows | length) - ($valid | length)),
       rows: [$valid[] | select(.[0] == $repo)
         | {pr: (.[1] | tonumber), skill: .[2], at: .[4], manual: (.[5] == "mark")}]}' "$LEDGER")
  [[ "$(jq '.bad' <<<"$ledger_json")" == "0" ]] || echo "pr-triage: ignoring malformed lines in $LEDGER" >&2
  ledger_json=$(jq -c '.rows' <<<"$ledger_json")
fi

# shellcheck disable=SC2016
classify='
  def footer: test("_written by |— _Claude Code_");
  def ts: if . == null then 0 else fromdateiso8601 end;
  def has_marker($m): (. // "") | contains("<!-- \($m) -->");
  # Review bots quote the markers back in their own comments, so only human authors count.
  def human_marker($m): ((.author.__typename // "") != "Bot") and (.body | has_marker($m));

  ($now // now) as $now
  | .data.viewer.login as $me
  | .data.repository.pullRequests as $prs
  | {
    repo: $repo,
    viewer: $me,
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
      | ($head.statusCheckRollup.contexts.nodes // []) as $ctx
      | ([$pr.createdAt, $pr.timelineItems.nodes[0].createdAt, $head.committedDate] | map(ts) | max)
        as $since

      # Bot state: done | running | none. A running bot is timed from when its run started;
      # one that never appeared, from when the PR became ready or got its newest commit.
      | ($ctx | map(select(.context == "CodeRabbit")) | last) as $cr
      | (if $cr == null then "none"
         elif $cr.state == "PENDING" then "running"
         elif ($cr.description // "") | startswith("Review skipped: draft") then "none"
         else "done" end) as $crState
      | ($ctx | map(select(.name == "Greptile Review")) | last) as $gr
      | (if $gr == null then "none" elif $gr.status == "COMPLETED" then "done" else "running" end)
        as $grState
      | (if any($pr.comments.nodes[]; ((.author.login // "") | startswith("qodo"))
             and ((.body // "") | contains("Code Review by Qodo"))) then "done" else "none" end)
        as $qoState
      | [["CodeRabbit", $crState, $cr.createdAt], ["Greptile", $grState, $gr.startedAt],
         ["Qodo", $qoState, null]]
      | map(select(.[1] != "done")
          | {name: .[0], overdue: (($now - (if .[1] == "running" and .[2] != null
                                              then .[2] | ts else $since end)) > $timeout)})
        as $unfinished
      | [$unfinished[] | select(.overdue | not) | .name] as $pendingBots
      | [$unfinished[] | select(.overdue) | .name] as $gaveUpOn

      # Skill runs, by anyone
      | ($ledger | map(select(.pr == $pr.number))) as $ledgerRows
      | ($ledgerRows | map(.skill)) as $logged
      | [$pr.reviews.nodes[] | select((.submittedAt | ts) < ($cutoff | ts))] as $legacy
      | (($logged | index("pr-local-test") != null)
          or any($pr.reviews.nodes[]; human_marker("pr-local-test")
            or any(.comments.nodes[]; human_marker("pr-local-test")))
          or any($legacy[]; (.body // "") as $b | ($b | footer) and ($b | contains("|"))))
        as $localRan
      # A report that could not recommend yet (its main check was blocked) needs another run.
      # The skill omits that line on a PR its runner authored, so a blocked run there still counts.
      # "." stands for the apostrophe, straight or curly.
      | ([$pr.reviews.nodes[] | select(human_marker("pr-local-test"))]
          | sort_by(.submittedAt // "") | last) as $lastLocal
      # Only a hand-recorded `mark` made after that report clears it: the skill logs every run,
      # blocked ones included, just after posting the report.
      | ([$ledgerRows[] | select(.manual and .skill == "pr-local-test") | .at | try ts catch 0]
          | max // 0) as $markedLocalAt
      | ((($lastLocal.body // "") | test("Can.t recommend yet"))
          and ($markedLocalAt <= ($lastLocal.submittedAt | ts))) as $localBlocked
      | ($localRan and ($localBlocked | not)) as $localTested
      # A clean inline review leaves only a "no issues" comment, and a local test always follows one.
      | ($localRan
          or ($logged | index("pr-review-inline") != null)
          or any($pr.comments.nodes[]; human_marker("pr-review-inline"))
          or any($pr.reviews.nodes[]; any(.comments.nodes[]; human_marker("pr-review-inline")))
          or any($legacy[]; (.body // "") == "" and any(.comments.nodes[];
               .replyTo == null and (.body | footer) and (.body | has_marker("pr-local-test") | not))))
        as $inlineReviewed

      # Threads
      | [$pr.reviewThreads.nodes[] | select(.isResolved | not)
          | (.comments.nodes[0].author.login // "ghost")] as $open
      | ($open | group_by(.) | map("\(.[0]) \(length)") | join(", ")) as $openBy
      # Past the first 100 threads none can be checked, so the PR waits rather than advancing.
      | ($pr.reviewThreads.pageInfo.hasNextPage // false) as $moreThreads
      | ($pr.reviewDecision == "APPROVED") as $approved
      | ($pr.mergeable == "CONFLICTING") as $conflicts

      | (if $pr.isDraft then ["DRAFT", ""]
         elif ($author | test("^(app/)?(renovate|release-please)(\\[bot\\])?$"))
           or ($pr.author.__typename == "Bot" and ($author | test("renovate|release-please")))
           then ["SKIP", ""]
         elif ($pendingBots | length) > 0 then ["BOTS", "waiting on \($pendingBots | join(", "))"]
         elif ($inlineReviewed | not) then ["INLINE", ""]
         elif ($open | length) > 0 or $moreThreads then ["THREADS",
           (if ($open | length) > 0 then "\($open | length) unresolved (\($openBy))" else "" end)
           + (if $moreThreads then "; over 100 threads, check the rest on GitHub" else "" end)
           + (if $localTested then "; both skills done" else "" end) | ltrimstr("; ")]
         elif ($localTested | not) then
           ["LOCAL", (if $localBlocked then "last local test could not recommend yet" else "" end)]
         elif $author == $me then
           ["OWN", (if $approved then "approved" else "needs another approver" end)]
         elif $approved then ["MERGE", ""]
         else ["MANUAL", ""]
         end) as $verdict
      | ($verdict[0] | IN("DRAFT", "SKIP") | not) as $active
      | {
          bucket: $verdict[0],
          number: $pr.number,
          # Newlines would split a card across lines in the terminal listing.
          title: ($pr.title | gsub("[\\r\\n]+"; " ")),
          author: $author,
          url: $pr.url,
          mine: ($author == $me),
          note: ([
            (if $verdict[1] != "" then $verdict[1] else empty end),
            (if $conflicts and $active then "merge conflicts" else empty end),
            (if ($gaveUpOn | length) > 0 and $active
             then "gave up waiting on \($gaveUpOn | join(", "))" else empty end)
          ] | join("; "))
        }
    ]
  }'

jq -e '.data.repository.pullRequests.nodes' <<<"$data" >/dev/null 2>&1 \
  || die "GitHub response had no pull request data for $repo: $(jq -c '.errors // .' <<<"$data" | head -c 300)"
board=$(jq --arg repo "$repo" --arg cutoff "$LEGACY_CUTOFF" \
  --argjson ledger "$ledger_json" --argjson timeout "$BOT_TIMEOUT_SECS" \
  --argjson now "${PR_TRIAGE_NOW:-null}" "$classify" <<<"$data") \
  || die "could not classify PRs for $repo"

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
    --warn: #8a5300; --warn-bg: #fff3dc;
    --c-bots: #8f96a3; --c-inline: #6f5cc4; --c-threads: #c27c1a; --c-local: #2f86b5;
    --c-manual: #2f9b62; --c-merge: #1f7a4a; --c-own: #7a8494;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --panel: #1a1e26; --card: #222833; --text: #e5e8ee; --muted: #9aa3b2;
      --border: #313948; --link: #7fb0ff; --chip: #26324a; --chip-text: #b7cbf2;
      --warn: #ffc56b; --warn-bg: #3a2d14;
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
    ["BOTS", "Waiting on AI bots", "CodeRabbit, Greptile and Qodo are still reviewing.", "--c-bots"],
    ["INLINE", "Needs /pr-review-inline", "Run the pr-review-inline skill on these.", "--c-inline"],
    ["THREADS", "Waiting on unresolved threads",
      "The author needs to address or reply to open review threads.", "--c-threads"],
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
  meta.append(el("code", "", "scripts/pr-triage.sh --html"), " to refresh.");
  if (data.truncated) {
    document.querySelector("header").append(
      el("div", "notice", `There are more open PRs: only the oldest ${data.fetched} are shown.`));
  }

  const board = document.getElementById("board");
  for (const [bucket, name, hint, accent] of columns) {
    const prs = data.prs.filter((pr) => pr.bucket === bucket);
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
      if (pr.mine && bucket !== "OWN") by.append(el("span", "chip", "yours"));
      card.append(head, by);
      if (pr.note) card.append(el("div", "note", pr.note));
      col.append(card);
    }
    board.append(col);
  }

  const drafts = data.prs.filter((pr) => pr.bucket === "DRAFT").length;
  const skipped = data.prs.filter((pr) => pr.bucket === "SKIP").map((pr) => `#${pr.number}`);
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
# empty note would shift the url left.
rows=$(jq -r '.prs[] | [.bucket, (.number | tostring), (.title | gsub("\u001f"; " ")), .author, .note, .url]
  | join("\u001f")' <<<"$board")

section() {
  local bucket="$1" heading="$2" matches
  matches=$(awk -F"$SEP" -v b="$bucket" '$1 == b' <<<"$rows")
  [[ -n "$matches" ]] || return 0
  printf '\n%s%s%s\n' "$bold" "$heading" "$reset"
  while IFS="$SEP" read -r _ num title author note url; do
    (( ${#title} > 70 )) && title="${title:0:67}..."
    printf '  #%-5s %s %s(%s)%s\n' "$num" "$title" "$dim" "$author" "$reset"
    [[ -n "$note" ]] && printf '         %s\n' "$note"
    printf '         %s%s%s\n' "$dim" "$url" "$reset"
  done <<<"$matches"
}

viewer=$(jq -r '.viewer' <<<"$board")
echo "${bold}PR triage for $repo${reset} ${dim}(as @$viewer)${reset}"
if [[ "$(jq -r '.truncated' <<<"$board")" == "true" ]]; then
  echo "  There are more open PRs; only the oldest $(jq -r '.fetched' <<<"$board") are shown"
fi
section LOCAL "Run /pr-local-test"
section INLINE "Run /pr-review-inline"
section MANUAL "Both skills done: waiting on codeowner review and approval"
section MERGE "Approved: waiting to merge"
section THREADS "Waiting on unresolved threads"
section BOTS "Waiting on AI bots"
section OWN "Your PRs: your steps are done"
drafts=$(awk -F"$SEP" '$1 == "DRAFT"' <<<"$rows" | grep -c . || true)
skipped=$(awk -F"$SEP" '$1 == "SKIP" { printf "#%s ", $2 }' <<<"$rows")
printf '\n%s%s drafts ignored; skipped (Renovate/release-please): %s%s\n' "$dim" "$drafts" "${skipped:-none}" "$reset"
