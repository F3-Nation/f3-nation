#!/usr/bin/env bash
# my-work: the open issues, PRs and security advisories whose next move is yours.
#
#   scripts/my-work.sh [-R owner/repo] [--html [--out FILE] [--no-open] | --json]
#
#   -R, --repo   repository to read (default: F3-Nation/f3-nation)
#   --html       write a single-page report instead of terminal text, and open it
#   --out FILE   where to write the report (default: $TMPDIR/my-work-<owner>-<repo>.html)
#   --no-open    write the report without opening it
#   --json       print the report's data as JSON
#
# Needs gh (signed in with `gh auth login`) and jq. Runs on macOS, Linux and WSL.
#
# The PRs come from `scripts/pr-triage.sh --with-advisories --json`, so whose turn a PR is follows
# the same rules as the team board. The report's sections, in order; each PR lands in the first
# one that fits it:
#
#   Your PRs        checks failing, merge conflicts, feedback to address (unresolved threads, a
#                   local test asking for changes, or a change request), approved and waiting to
#                   merge; then, for reference, your drafts and the PRs waiting on someone else
#   Your issues     open issues assigned to you with no open PR linked to them (a draft counts)
#   Reviewing       the author replied in a thread that is yours to answer; or, assigned to you,
#                   a skill to run, a review and approval, or a merge
#   Unassigned      codeowners only: PRs nobody but their author is assigned to, needing
#                   /pr-review-inline, or past it and needing /pr-local-test, approval or a merge
#   Security        the security advisories you can see that have no fix PR
#
# Your drafts and your PRs waiting on someone else come last, for reference. A PR that isn't
# your turn, such as one assigned to someone else or waiting on its author, is left out.
# Advisory data is private to people with advisory access: never post or log this output
# publicly. The HTML file is readable only by you.

# Sourced, every exit below would close the caller's shell and set -e would stay on in it.
if (return 0 2>/dev/null); then
  echo "my-work: run this with bash scripts/my-work.sh (or pnpm my-work), not with '.' or source" >&2
  return 1
fi
set -euo pipefail

SEP=$'\x1f'
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/open-file.sh
. "$script_dir/lib/open-file.sh"

usage() { sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "my-work: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required. $2"; }

repo="F3-Nation/f3-nation" html=false json=false out="" open_report=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    -R | --repo) [[ $# -ge 2 ]] || usage 1; repo="$2"; shift 2 ;;
    --html) html=true; shift ;;
    --out) [[ $# -ge 2 ]] || usage 1; out="$2"; html=true; shift 2 ;;
    --no-open) open_report=false; shift ;;
    --json) json=true; shift ;;
    -h | --help) usage 0 ;;
    *) usage 1 ;;
  esac
done
[[ "$repo" == */* ]] || die "--repo must look like owner/name"
if $json && $html; then usage 1; fi

need jq "Install it with 'brew install jq' (macOS) or 'sudo apt-get install jq' (Linux/WSL)."
need gh "Install it from https://cli.github.com, then run 'gh auth login'."
gh auth status >/dev/null 2>&1 || die "gh isn't signed in. Run 'gh auth login' first."

report_tmp=""
trap '[[ -z "$report_tmp" ]] || rm -f "$report_tmp"' EXIT

board=$(bash "$script_dir/pr-triage.sh" -R "$repo" --with-advisories --json) \
  || die "pr-triage couldn't read the PRs for $repo"

# Search reads only the first 100 issues; issueCount tells the report when there are more.
# shellcheck disable=SC2016
issues_query='
query($q: String!) {
  search(type: ISSUE, query: $q, first: 100) {
    issueCount
    nodes {
      ... on Issue {
        number title url createdAt
        labels(first: 20) { nodes { name } }
        closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
          nodes { number url isDraft }
        }
      }
    }
  }
}'
issues=$(gh api graphql -f query="$issues_query" \
  -f q="repo:$repo is:issue is:open assignee:@me sort:created-asc") \
  || die "couldn't read the issues assigned to you in $repo"
jq -e '.data.search.nodes' >/dev/null 2>&1 <<<"$issues" \
  || die "GitHub response had no issue data for $repo: $(jq -c '.errors // .' <<<"$issues" | head -c 300)"

# Both documents reach jq on stdin: printf is a builtin, so private advisory titles never appear
# in a process's argv, and a large board can't hit the per-argument size limit.
# shellcheck disable=SC2016
report=$(printf '%s\n%s\n' "$board" "$issues" | jq -n 'input as $board | input as $issues
  | def days_since($t): (try ($t | fromdateiso8601) catch null) as $s
    | if $s == null then null
      else (($board.generatedAt | fromdateiso8601) - $s) / 86400 | floor | if . < 0 then 0 else . end end;
  def stage: {
    INLINE: "needs /pr-review-inline", LOCAL: "needs /pr-local-test",
    MANUAL: "needs codeowner approval", MERGE: "approved, ready to merge",
    THREADS: "waiting on the author", REPLY: "waiting on a reviewer'"'"'s reply",
    OWN: (if .approved then "approved" else "needs another approver" end), DRAFT: "draft"
  }[.bucket] // "";
  def checks: {FAILURE: "checks failing", ERROR: "checks failing",
    PENDING: "checks running", EXPECTED: "checks running"}[.ciState // ""] // "";
  def failing: .ciState | IN("FAILURE", "ERROR");
  # Failing checks and merge conflicts are the author'"'"'s to fix, and clear once they push. A
  # change request is not here: it stays on GitHub after the fix is pushed, until the reviewer
  # looks again.
  def authorBlocked: failing or .conflicts;

  ($board.viewer | ascii_downcase) as $me
  | ($board.codeowners | index($me) != null) as $isCodeowner
  | def section:
      if .bucket == "SKIP" then null
      elif .mine then
        if failing then "MY_CI"
        elif .conflicts then "MY_CONFLICTS"
        elif .bucket == "DRAFT" then "MY_DRAFTS"
        elif .bucket == "THREADS" or .changesRequested or (.threadsAwaitingAuthor // 0) > 0
          then "MY_FEEDBACK"
        elif .bucket == "OWN" and .approved then "MY_APPROVED"
        else "MY_WAITING" end
      elif .bucket == "DRAFT" or (.viewersTurn | not) then null
      elif .bucket == "REPLY" then "REPLY"
      elif authorBlocked then null
      elif .assignedToMe then
        {INLINE: "ASSIGNED_SKILL", LOCAL: "ASSIGNED_SKILL", MANUAL: "ASSIGNED_APPROVE",
         MERGE: "ASSIGNED_MERGE"}[.bucket]
      elif $isCodeowner and (.claimedByOther | not) then
        if .bucket == "INLINE" then "PICKUP_INLINE"
        elif .bucket | IN("LOCAL", "MANUAL", "MERGE") then "PICKUP_LATER"
        else null end
      else null end;

  [$board.prs[] | {section: section, pr: .} | select(.section != null)
    | .pr as $pr
    | {section, kind: "pr", ref: ($pr.ref // "#\($pr.number)"), number: $pr.number,
       title: $pr.title, url: $pr.url, author: $pr.author, assignee: $pr.assignee,
       advisory: ($pr.advisory // null), since: $pr.turnSince, days: days_since($pr.turnSince),
       note: ([($pr | stage), ($pr.note | split("; ")[]), ($pr | checks),
               (if $pr.changesRequested then "changes requested" else "" end)]
              | reduce .[] as $part ([]; if $part == "" or any(.[]; . == $part) then . else . + [$part] end)
              | join("; "))}] as $prItems

  | [$issues.data.search.nodes[]
      | select((.closedByPullRequestsReferences.nodes // []) | length == 0)
      | {section: "ISSUES", kind: "issue", ref: "#\(.number)", number, title, url,
         days: days_since(.createdAt),
         note: ([.labels.nodes[]?.name] | join(", "))}] as $issueItems

  | [$board.advisoriesWithoutPr // [] | .[]
      | {section: "ADVISORIES", kind: "advisory", ref: .ghsa, title: .summary, url,
         severity, days: days_since(.createdAt),
         note: (if .draftPr then "draft fix PR open" else "" end)}] as $advisoryItems

  | ($issueItems + $prItems + $advisoryItems) as $items
  | {
      repo: $board.repo, viewer: $board.viewer, generatedAt: $board.generatedAt,
      isCodeowner: $isCodeowner,
      notes: ([($board.advisoryNotes // [])[],
        (if $board.truncated then "There are more open PRs: only the oldest \($board.fetched) were read." else empty end),
        (if $board.reviewDecisionsMissing then "GitHub couldn'"'"'t read approvals for some PRs, so approved ones show as needing approval and change requests may be missing." else empty end),
        (if $issues.data.search.issueCount > ($issues.data.search.nodes | length)
         then "You have more than \($issues.data.search.nodes | length) open issues: only the oldest were read." else empty end)]),
      sections: [
        ["MY_CI", "Your PRs", "Checks failing", "A check on the latest commit failed."],
        ["MY_CONFLICTS", "Your PRs", "Merge conflicts", "Merge main into the branch and resolve the conflicts."],
        ["MY_FEEDBACK", "Your PRs", "Feedback to address", "Unresolved review threads, a local test that asked for changes, or a change request."],
        ["MY_APPROVED", "Your PRs", "Approved: waiting to merge", "Anyone with write access can add these to the merge queue."],
        ["ISSUES", "Your issues", "Assigned issues with no open PR", "Open issues assigned to you with no open PR linked to them (Closes #N, or linked from the issue)."],
        ["REPLY", "Reviewing", "The author replied: your turn in the threads", "Answer or resolve the threads the author replied to."],
        ["ASSIGNED_SKILL", "Reviewing", "Assigned to you: run a review skill", "Run the skill named on each card."],
        ["ASSIGNED_APPROVE", "Reviewing", "Assigned to you: review and approve", "Both skills are done."],
        ["ASSIGNED_MERGE", "Reviewing", "Assigned to you: ready to merge", "Approved; add these to the merge queue."],
        ["PICKUP_INLINE", "Unassigned PRs", "Needs /pr-review-inline", "Nobody but the author is assigned. Assign yourself and run the skill."],
        ["PICKUP_LATER", "Unassigned PRs", "Needs /pr-local-test, approval or a merge", "Nobody but the author is assigned. The card says what is next."],
        ["ADVISORIES", "Security advisories", "Advisories with no fix PR", "Open security advisories with no fix PR ready for review."],
        ["MY_DRAFTS", "For reference", "Your drafts", "Not on anyone else'"'"'s list until marked ready for review."],
        ["MY_WAITING", "For reference", "Your PRs waiting on others", "Your steps are done; the card says who is next."]
      ] | map(. as [$key, $group, $title, $hint]
          | {key: $key, group: $group, title: $title, hint: $hint,
             items: [$items[] | select(.section == $key) | del(.section)]})
    }') || die "could not build the report"

if $json; then
  printf '%s\n' "$report"
  exit 0
fi

if $html; then
  [[ -n "$out" ]] || out="${TMPDIR:-/tmp}"
  # pnpm runs scripts from the repository root; INIT_CWD is where the user ran the command.
  [[ "$out" == /* ]] || out="${INIT_CWD:-$PWD}/$out"
  [[ -d "$out" ]] && out="${out%/}/my-work-${repo%%/*}-${repo#*/}.html"
  # "<" is escaped so no title can close the <script> block it is embedded in.
  json=$(jq -c '.' <<<"$report" | sed 's/</\\u003c/g')
  # Written to a new mode-0600 file, since it can name unfixed security advisories, and renamed
  # over any older report.
  report_tmp=$(mktemp "$(dirname "$out")/.my-work.XXXXXX") || die "could not write $out"
  {
    cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My work</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #eceef2; --card: #ffffff; --text: #1d2330; --muted: #5d6677;
    --border: #d9dde5; --link: #1f5fbf; --chip: #e7ecf6; --chip-text: #2d4a80;
    --warn: #8a5300; --warn-bg: #fff3dc; --adv: #a3202a; --adv-bg: #fde4e4;
    --sev-high: #b42318; --sev-high-bg: #fde4e4; --sev-medium: #9a4a00; --sev-medium-bg: #ffe6cc;
    --sev-low: #6f5600; --sev-low-bg: #fff3b8;
    --c-issues: #6f5cc4; --c-mine: #c27c1a; --c-review: #2f86b5; --c-pickup: #2f9b62;
    --c-ref: #7a8494;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12151b; --panel: #1a1e26; --card: #222833; --text: #e5e8ee; --muted: #9aa3b2;
      --border: #313948; --link: #7fb0ff; --chip: #26324a; --chip-text: #b7cbf2;
      --warn: #ffc56b; --warn-bg: #3a2d14; --adv: #ffb3b3; --adv-bg: #4a1d22;
      --sev-high: #ffb3b3; --sev-high-bg: #4f1b1f; --sev-medium: #ffc787; --sev-medium-bg: #4a2a10;
      --sev-low: #ffe58a; --sev-low-bg: #3f3510;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header, main, footer { max-width: 860px; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
  header { padding-top: 20px; padding-bottom: 8px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; }
  .meta code { background: var(--panel); padding: 1px 5px; border-radius: 4px; }
  .notice { margin-top: 10px; padding: 8px 12px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
  .summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .summary a { font-size: 12px; padding: 3px 10px; border-radius: 12px; text-decoration: none;
    border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .group { background: var(--panel); border-radius: 8px; border-left: 4px solid var(--accent);
    padding: 10px 12px; margin: 12px 0; }
  .group > h2 { font-size: 16px; margin: 0 0 4px; }
  .group h3 { font-size: 14px; margin: 12px 0 0; display: flex; justify-content: space-between; gap: 8px; }
  .count { color: var(--muted); font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; margin: 2px 0 8px; }
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
  .card .advisory { background: var(--adv-bg); color: var(--adv); }
  .card .advisory.sev-high { background: var(--sev-high-bg); color: var(--sev-high); }
  .card .advisory.sev-medium { background: var(--sev-medium-bg); color: var(--sev-medium); }
  .card .advisory.sev-low { background: var(--sev-low-bg); color: var(--sev-low); }
  .note { font-size: 12px; margin-top: 4px; color: var(--muted); overflow-wrap: anywhere; }
  .empty { color: var(--muted); font-style: italic; margin: 16px 0; }
  footer { color: var(--muted); font-size: 12px; padding-bottom: 24px; }
</style>
</head>
<body>
<header>
  <h1 id="heading">My work</h1>
  <div class="meta" id="meta"></div>
  <nav class="summary" id="summary" aria-label="Sections"></nav>
</header>
<main id="report"></main>
<footer>PRs that aren't your turn are left out. <code>scripts/my-work.sh --help</code> lists the rules.</footer>
<script type="application/json" id="data">
HTML
    printf '%s\n' "$json"
    cat <<'HTML'
</script>
<script>
  const data = JSON.parse(document.getElementById("data").textContent);
  const accents = {
    "Your issues": "--c-issues", "Your PRs": "--c-mine", "Reviewing": "--c-review",
    "Unassigned PRs": "--c-pickup", "Security advisories": "--adv", "For reference": "--c-ref",
  };
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
  const tone = (severity) => ({ high: " sev-high", critical: " sev-high", medium: " sev-medium", low: " sev-low" })[severity] ?? "";

  document.getElementById("heading").textContent = `My work · ${data.repo}`;
  document.title = `My work · ${data.repo}`;
  const meta = document.getElementById("meta");
  meta.append(`Generated ${new Date(data.generatedAt).toLocaleString()} for @${data.viewer}. Rerun `);
  meta.append(el("code", "", "pnpm my-work:html"), " to refresh.");
  for (const note of data.notes) document.querySelector("header").append(el("div", "notice", note));

  const card = (item) => {
    const node = el("article", "card");
    const head = el("div", "title");
    head.append(link(item.url, "num", item.ref), link(item.url, "", item.title));
    const by = el("div", "by");
    if (item.kind === "pr") by.append(el("span", "", `@${item.author}`));
    if (item.kind === "advisory") by.append(el("span", `chip advisory${tone(item.severity)}`, item.severity ?? "no severity"));
    if (item.advisory) {
      by.append(link(item.advisory.url, `chip advisory${tone(item.advisory.severity)}`, item.advisory.severity ?? "no severity"));
    }
    if (item.kind === "pr") by.append(el("span", "", item.assignee === "Unassigned" ? "Unassigned" : `Assigned: ${item.assignee}`));
    if (item.days !== null && item.days !== undefined) {
      by.append(el("span", "", item.kind === "pr" ? `waiting ${item.days}d` : `opened ${item.days}d ago`));
    }
    node.append(head, by);
    if (item.note) node.append(el("div", "note", item.note));
    return node;
  };

  const report = document.getElementById("report");
  const summary = document.getElementById("summary");
  const groups = [...new Set(data.sections.map((s) => s.group))];
  let total = 0;
  for (const group of groups) {
    const sections = data.sections.filter((s) => s.group === group && s.items.length > 0);
    if (sections.length === 0) continue;
    const box = el("section", "group");
    box.id = group.toLowerCase().replace(/[^a-z]+/g, "-");
    box.style.setProperty("--accent", `var(${accents[group] ?? "--c-ref"})`);
    box.append(el("h2", "", group));
    let count = 0;
    for (const section of sections) {
      const h3 = el("h3");
      h3.append(el("span", "", section.title), el("span", "count", String(section.items.length)));
      box.append(h3, el("div", "hint", section.hint));
      for (const item of section.items) box.append(card(item));
      count += section.items.length;
    }
    if (group !== "For reference") total += count;
    const jump = el("a", "", `${group} (${count})`);
    jump.href = `#${box.id}`;
    summary.append(jump);
    report.append(box);
  }
  if (total === 0) report.prepend(el("p", "empty", "Nothing is waiting on you."));
</script>
</body>
</html>
HTML
  } >"$report_tmp"
  mv -f "$report_tmp" "$out"
  report_tmp=""
  echo "Wrote $out"
  if $open_report; then
    open_file "$out" || echo "Open it in your browser to view the report."
  fi
  exit 0
fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  bold=$'\e[1m' dim=$'\e[2m' reset=$'\e[0m'
else
  bold="" dim="" reset=""
fi

echo "${bold}My work in $(jq -r .repo <<<"$report")${reset} ${dim}(as @$(jq -r .viewer <<<"$report"))${reset}"
# Remote text could carry terminal escape sequences, so C0/C1 controls and DEL become spaces.
jq -r '.notes[] | "  \(gsub("[\u0001-\u001f\u007f-\u009f]+"; " "))"' <<<"$report"

# Fields are split on \x1f, not tab: `read` collapses runs of whitespace separators, so an
# empty field would shift the rest left.
rows=$(jq -r '.sections[] | select(.items | length > 0) as $s
  | ($s.group + "\u001f" + $s.title + "\u001f\u001f\u001f\u001f"),
    ($s.items[] | ["", "",
      .ref + (if .kind == "advisory" or .advisory then " [\((.advisory // .).severity // "no severity")]" else "" end),
      (.title
        + (if .kind == "pr" then " (\(.author))" else "" end)),
      ([(if .kind == "pr" then "Assignee: \(.assignee)" else empty end),
        (if .days == null then empty elif .kind == "pr" then "waiting \(.days)d" else "opened \(.days)d ago" end),
        (if .note != "" then .note else empty end)] | join(" · ")),
      .url] | map(tostring | gsub("[\u0001-\u001f\u007f-\u009f]+"; " ")) | join("\u001f"))' <<<"$report")

if [[ -z "$rows" ]]; then
  echo
  echo "Nothing is waiting on you."
  exit 0
fi

last_group=""
while IFS="$SEP" read -r group title ref heading detail url; do
  if [[ -n "$group" ]]; then
    if [[ "$group" != "$last_group" ]]; then
      printf '\n%s%s%s\n' "$bold" "$group" "$reset"
      last_group="$group"
    fi
    printf '  %s\n' "$title"
    continue
  fi
  (( ${#heading} > 80 )) && heading="${heading:0:77}..."
  printf '    %-8s %s\n' "$ref" "$heading"
  [[ -n "$detail" ]] && printf '             %s\n' "$detail"
  printf '             %s%s%s\n' "$dim" "$url" "$reset"
done <<<"$rows"
