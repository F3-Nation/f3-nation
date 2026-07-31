"use strict";

/**
 * Shared by .github/workflows/code-scanning-issue.yml and
 * code-scanning-backfill.yml so both render identical issues.
 * CommonJS because actions/github-script loads it with require().
 */

const TITLE_PREFIX = "[code scanning] Alert #";

function issueTitle(alert) {
  return `${TITLE_PREFIX}${alert.number}: ${alert.rule?.id ?? "unknown rule"}`;
}

/**
 * Absolute permalink to the flagged lines, pinned to the alert's commit.
 * Relative links are not resolved reliably in issue bodies, so the repo URL is
 * recovered from the alert's own html_url
 * (https://github.com/OWNER/REPO/security/code-scanning/N).
 */
function permalink(alert) {
  const instance = alert.most_recent_instance ?? {};
  const path = instance.location?.path;
  const sha = instance.commit_sha;
  const repoUrl = (alert.html_url ?? "").split("/security/code-scanning/")[0];
  if (!path || !sha || !repoUrl) return null;
  const start = instance.location.start_line;
  const end = instance.location.end_line ?? start;
  const anchor = start
    ? `#L${start}${end && end !== start ? `-L${end}` : ""}`
    : "";
  return `${repoUrl}/blob/${sha}/${path}${anchor}`;
}

function renderIssue(alert, issueNumber = null) {
  const rule = alert.rule ?? {};
  const instance = alert.most_recent_instance ?? {};
  const location = instance.location ?? {};
  const link = permalink(alert);

  const lines = [
    `> Filed automatically from [code scanning alert #${alert.number}](${alert.html_url ?? ""}).`,
    "",
    "## Summary",
    "",
    rule.full_description ??
      rule.description ??
      "_No description provided by the scanning tool._",
    "",
    "## Alert details",
    "",
    "| | |",
    "| --- | --- |",
    `| Rule | \`${rule.id ?? "unknown"}\` |`,
    `| Severity | ${rule.severity ?? "unknown"} |`,
    `| Security severity | ${rule.security_severity_level ?? "not classified"} |`,
    `| Tool | ${alert.tool?.name ?? "unknown"} ${alert.tool?.version ?? ""} |`,
    `| Tags | ${(rule.tags ?? []).map((t) => `\`${t}\``).join(", ") || "none"} |`,
    `| State | ${alert.state ?? "unknown"} |`,
    `| First detected | ${alert.created_at ?? "unknown"} |`,
    `| Last updated | ${alert.updated_at ?? "unknown"} |`,
    "",
    "## Location",
    "",
    location.path
      ? `\`${location.path}\`${location.start_line ? `, line ${location.start_line}` : ""}` +
        (link
          ? `\n\n[View the flagged code at the time of the alert](${link})`
          : "")
      : "_The tool did not report a file location._",
    "",
    instance.message?.text ? `> ${instance.message.text}` : "",
    "",
    "## Recommendation",
    "",
    rule.help ??
      "_The scanning tool did not ship remediation guidance. See the alert page._",
    "",
    "## How this issue closes",
    "",
    issueNumber
      ? `Put \`Fixes #${issueNumber}\` in your pull request description. When the PR merges, this issue closes.`
      : "Reference this issue with a `Fixes` keyword and this issue's number in your pull request description.",
    "",
    "The alert itself is **not** closed by this issue. Once the fix lands on `main`," +
      " the scanner re-runs and marks the alert fixed on its own; if this issue is still" +
      " open at that point, automation closes it.",
    "",
    `[Open the alert](${alert.html_url ?? ""})`,
  ];

  return { title: issueTitle(alert), body: lines.join("\n") };
}

/**
 * Lists issues and matches the title prefix exactly.
 * Deliberately not the search API: the search index is eventually consistent,
 * and its fuzzy matching would let "Alert #4:" match "Alert #42:".
 */
async function findExistingIssue(github, owner, repo, alertNumber) {
  const marker = `${TITLE_PREFIX}${alertNumber}:`;
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });
  const hit = issues.find(
    (issue) => !issue.pull_request && (issue.title ?? "").startsWith(marker),
  );
  return hit ? { number: hit.number, state: hit.state } : null;
}

module.exports = { renderIssue, findExistingIssue, TITLE_PREFIX };
