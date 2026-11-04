"use strict";

/**
 * Logic for .github/workflows/pr-author-nudge.yml (#1491).
 *
 * Nudges, then closes, PRs that are waiting on their author. The clock runs
 * only while it's the author's turn under docs/PR_REVIEW_PROCESS.md: the PR is
 * a draft, a required check is failing, it conflicts with its base, a review
 * thread is waiting on the author, or a reviewer requested changes and nothing
 * has been pushed since. While the PR waits on bots or codeowners the clock is
 * paused, and any push or author comment resets it. Bot comments and reviewer
 * pings don't.
 *
 * CommonJS because actions/github-script loads it with require(). `decide()`
 * and its helpers are pure; `run()` fetches and writes. Run this file directly
 * for a local dry run through the gh CLI:
 *
 *   node .github/scripts/pr-author-nudge.cjs [owner/repo]
 */

const MARKER = "<!-- pr-author-nudge";
const STALE_LABEL = "stale";
const KEEP_OPEN_LABEL = "keep-open";
const DAY_MS = 24 * 60 * 60 * 1000;

// Days of the author's turn before the nudge and before the close, by who the
// author is to the repo (agreed in #monorepo, 11/3). Drafts follow the same
// timings. The close also needs a nudge posted at least (close - nudge) days
// earlier in the same stretch, so nobody is closed without that much warning.
const DAYS = {
  team: { nudge: 5, close: 10 }, // owners, members and collaborators
  outside: { nudge: 3, close: 7 }, // everyone else, including forks
};
const TEAM_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// Authors whose PRs are never nudged. GraphQL logins carry no `[bot]` suffix.
const EXEMPT_AUTHORS = ["renovate", "f3-nation-release-please"];

const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const FAILING_STATES = new Set(["FAILURE", "ERROR"]);

const ts = (iso) => (iso ? Date.parse(iso) : null);
const maxTs = (...values) => {
  const present = values.filter((v) => v != null);
  return present.length ? Math.max(...present) : null;
};
const minTs = (...values) => {
  const present = values.filter((v) => v != null);
  return present.length ? Math.min(...present) : null;
};

/** Reads the state the bot keeps in its own comment, or null. */
function parseMarker(body) {
  if (!body || !body.includes(MARKER)) return null;
  const match = body.match(/<!-- pr-author-nudge (\{.*?\}) -->/);
  if (!match) return { nudgedAt: null };
  try {
    return JSON.parse(match[1]);
  } catch {
    return { nudgedAt: null };
  }
}

/**
 * Turns one GraphQL PR node (see PR_FIELDS) into the plain facts `decide()`
 * needs. `requiredContexts` is the list of required check names on the base.
 * `nudge` is `{ id, nudgedAt }` for the bot's existing comment, or null.
 */
function summarize(pr, requiredContexts, nudge) {
  const author = pr.author?.login ?? null;
  const isBotAuthor = pr.author?.__typename === "Bot";
  const created = ts(pr.createdAt);
  const timeline = pr.timelineItems?.nodes ?? [];

  let lastPush = null; // any push, by anyone: work is happening
  let lastAuthorActivity = created;
  let lastDraftStart = pr.isDraft ? created : null;
  let lastHandoff = created; // latest event that put the PR in front of someone
  const latestReviewByReviewer = new Map();

  for (const item of timeline) {
    switch (item.__typename) {
      case "PullRequestCommit":
        lastPush = maxTs(lastPush, ts(item.commit?.committedDate));
        break;
      case "HeadRefForcePushedEvent":
        lastPush = maxTs(lastPush, ts(item.createdAt));
        break;
      case "ConvertToDraftEvent":
        lastDraftStart = maxTs(lastDraftStart, ts(item.createdAt));
        if (item.actor?.login === author)
          lastAuthorActivity = maxTs(lastAuthorActivity, ts(item.createdAt));
        break;
      case "ReadyForReviewEvent":
      case "ReopenedEvent":
        lastHandoff = maxTs(lastHandoff, ts(item.createdAt));
        if (item.actor?.login === author)
          lastAuthorActivity = maxTs(lastAuthorActivity, ts(item.createdAt));
        break;
      case "IssueComment":
        if (item.author?.login === author)
          lastAuthorActivity = maxTs(lastAuthorActivity, ts(item.createdAt));
        break;
      case "PullRequestReview": {
        const at = ts(item.submittedAt);
        const who = item.author?.login;
        if (who === author) {
          // Replies to review threads arrive as the author's own reviews.
          lastAuthorActivity = maxTs(lastAuthorActivity, at);
        } else if (who) {
          lastHandoff = maxTs(lastHandoff, at);
          if (item.state !== "COMMENTED" && item.state !== "PENDING") {
            const prev = latestReviewByReviewer.get(who);
            if (!prev || at > prev.at)
              latestReviewByReviewer.set(who, { state: item.state, at });
          }
        }
        break;
      }
      default:
        break;
    }
  }
  // An author's replies in review threads don't appear in the timeline, so
  // they're read from the threads themselves.
  const threads = pr.reviewThreads?.nodes ?? [];
  const lastComment = (thread) => thread.comments?.nodes?.at(-1);
  for (const thread of threads) {
    for (const comment of thread.comments?.nodes ?? []) {
      if (comment.author?.login === author)
        lastAuthorActivity = maxTs(lastAuthorActivity, ts(comment.createdAt));
    }
  }
  lastAuthorActivity = maxTs(lastAuthorActivity, lastPush);

  const reasons = [];

  if (pr.isDraft) {
    reasons.push({ kind: "draft", since: lastDraftStart ?? created });
  }

  const contexts =
    pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const failing = [];
  let failingSince = null;
  for (const name of requiredContexts) {
    const runs = contexts
      .filter((c) => (c.name ?? c.context) === name)
      .map((c) => ({
        failed:
          c.__typename === "CheckRun"
            ? FAILING_CONCLUSIONS.has(c.conclusion)
            : FAILING_STATES.has(c.state),
        at: ts(c.completedAt ?? c.createdAt),
      }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    if (runs[0]?.failed) {
      failing.push(name);
      failingSince = minTs(failingSince, runs[0].at);
    }
  }
  if (!pr.isDraft && failing.length) {
    reasons.push({ kind: "checks", since: failingSince, names: failing });
  }

  if (!pr.isDraft && pr.mergeable === "CONFLICTING") {
    // GitHub records no time for a conflict appearing; the latest handoff is
    // the closest honest stand-in, and the close still waits on a nudge.
    reasons.push({ kind: "conflict", since: lastHandoff });
  }

  const waitingThreads = threads.filter((thread) => {
    if (thread.isResolved) return false;
    const last = lastComment(thread);
    return last && last.author?.login !== author;
  });
  if (!pr.isDraft && waitingThreads.length) {
    reasons.push({
      kind: "threads",
      since: minTs(...waitingThreads.map((t) => ts(lastComment(t).createdAt))),
      count: waitingThreads.length,
    });
  }

  const changesRequested = [...latestReviewByReviewer.entries()].filter(
    ([, review]) =>
      review.state === "CHANGES_REQUESTED" &&
      (lastPush == null || review.at > lastPush),
  );
  if (!pr.isDraft && changesRequested.length) {
    reasons.push({
      kind: "changes",
      since: minTs(...changesRequested.map(([, r]) => r.at)),
      reviewers: changesRequested.map(([who]) => who),
    });
  }

  const labels = (pr.labels?.nodes ?? []).map((l) => l.name);
  return {
    number: pr.number,
    title: pr.title,
    author,
    isDraft: pr.isDraft,
    tier: TEAM_ASSOCIATIONS.has(pr.authorAssociation) ? "team" : "outside",
    exempt:
      isBotAuthor ||
      EXEMPT_AUTHORS.includes(author) ||
      labels.includes(KEEP_OPEN_LABEL),
    reasons,
    lastAuthorActivity,
    nudge,
  };
}

/**
 * What to do with one summarized PR at time `now` (ms):
 * `{ action: "none" | "nudge" | "close", why, clockStart, ageDays, closeAt }`.
 */
function decide(facts, now) {
  if (facts.exempt) return { action: "none", why: "exempt" };
  if (!facts.reasons.length)
    return { action: "none", why: "not author's turn" };

  const days = DAYS[facts.tier];
  const turnStart = minTs(...facts.reasons.map((r) => r.since));
  const clockStart = maxTs(turnStart, facts.lastAuthorActivity);
  const ageDays = (now - clockStart) / DAY_MS;
  const nudgedAt = ts(facts.nudge?.nudgedAt);
  const nudgedThisStretch = nudgedAt != null && nudgedAt >= clockStart;
  const closeAt = nudgedThisStretch
    ? Math.max(
        clockStart + days.close * DAY_MS,
        nudgedAt + (days.close - days.nudge) * DAY_MS,
      )
    : null;

  if (nudgedThisStretch && now >= closeAt) {
    return {
      action: "close",
      why: "author's turn",
      clockStart,
      ageDays,
      closeAt,
    };
  }
  if (!nudgedThisStretch && ageDays >= days.nudge) {
    return {
      action: "nudge",
      why: "author's turn",
      clockStart,
      ageDays,
      closeAt: now + (days.close - days.nudge) * DAY_MS,
    };
  }
  return {
    action: "none",
    why: nudgedThisStretch
      ? "nudged, waiting"
      : "author's turn, under the limit",
    clockStart,
    ageDays,
    closeAt,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line per open item, in the author's words. */
function describeReasons(reasons) {
  return reasons.map((r) => {
    switch (r.kind) {
      case "draft":
        return "It's still a draft. Mark it **Ready for review** once CI passes and it's ready for others to look at.";
      case "checks":
        return `Required ${r.names.length === 1 ? "check" : "checks"} failing: ${r.names.map((n) => `\`${n}\``).join(", ")}.`;
      case "conflict":
        return "It has a merge conflict with `main`.";
      case "threads":
        return `${plural(r.count, "review thread")} ${r.count === 1 ? "is" : "are"} waiting on you: reply to each (say what you changed or why not), then resolve it.`;
      case "changes":
        return `${r.reviewers.map((w) => `@${w}`).join(", ")} requested changes, and nothing has been pushed since.`;
      default:
        return r.kind;
    }
  });
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function nudgeBody(facts, decision, now) {
  const state = JSON.stringify({ nudgedAt: new Date(now).toISOString() });
  return [
    `${MARKER} ${state} -->`,
    `👋 @${facts.author}, this PR has been waiting on you for ${plural(Math.floor(decision.ageDays), "day")}:`,
    "",
    ...describeReasons(facts.reasons).map((line) => `- ${line}`),
    "",
    `If nothing changes, it will be closed on or after **${day(decision.closeAt)}**. You can reopen it any time.`,
    "",
    "A push or a comment from you resets the clock. If you're stuck or waiting on something, say so in a comment. The steps are in [PR_REVIEW_PROCESS.md](https://github.com/F3-Nation/f3-nation/blob/main/docs/PR_REVIEW_PROCESS.md).",
  ].join("\n");
}

function closeBody(facts, decision) {
  return [
    `Closing this PR: it has waited on @${facts.author} for ${plural(Math.floor(decision.ageDays), "day")} since the reminder above.`,
    "",
    "Reopen it whenever you pick it back up. A maintainer may also finish the work in a new PR and credit you with a `Co-authored-by` trailer.",
  ].join("\n");
}

// Ten PRs per page: each pulls its timeline, threads and checks, and bigger
// pages risk GitHub's ~10s GraphQL limit (same finding as scripts/pr-triage.sh).
const PAGE_SIZE = 10;
const PR_FIELDS = `
  number title isDraft createdAt mergeable authorAssociation
  author { login __typename }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 100, itemTypes: [PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT,
      READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REOPENED_EVENT, ISSUE_COMMENT,
      PULL_REQUEST_REVIEW]) {
    nodes {
      __typename
      ... on PullRequestCommit { commit { committedDate } }
      ... on HeadRefForcePushedEvent { createdAt }
      ... on ReadyForReviewEvent { createdAt actor { login } }
      ... on ConvertToDraftEvent { createdAt actor { login } }
      ... on ReopenedEvent { createdAt actor { login } }
      ... on IssueComment { databaseId createdAt author { login } }
      ... on PullRequestReview { submittedAt state author { login } }
    }
  }
  reviewThreads(first: 100) {
    nodes { isResolved comments(last: 20) { nodes { createdAt author { login } } } }
  }
  commits(last: 1) {
    nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name conclusion completedAt }
      ... on StatusContext { context state createdAt }
    } } } } }
  }`;

/**
 * Fetches every open PR, decides, and (unless dryRun) comments, closes and
 * labels. `github` is actions/github-script's client (or the gh shim below).
 * Returns the rows for the job summary.
 */
async function run({
  github,
  owner,
  repo,
  dryRun,
  now = Date.now(),
  botLogin = "github-actions",
  log = console.log,
}) {
  const rules = await github.paginate(
    "GET /repos/{owner}/{repo}/rules/branches/{branch}",
    {
      owner,
      repo,
      branch: "main",
      per_page: 100,
    },
  );
  const requiredContexts = rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c.context);

  const prs = [];
  let cursor = null;
  for (;;) {
    const result = await github.graphql(
      `query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(states: OPEN, first: ${PAGE_SIZE}, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { ${PR_FIELDS} }
          }
        }
      }`,
      { owner, repo, cursor },
    );
    const connection = result.repository.pullRequests;
    prs.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  const rows = [];
  for (const pr of prs) {
    const row = { pr: pr.number, author: pr.author?.login, outcome: "" };
    try {
      // Only the bot's own comments are fetched with bodies, to find its marker.
      const botComments = (pr.timelineItems?.nodes ?? []).filter(
        (n) => n.__typename === "IssueComment" && n.author?.login === botLogin,
      );
      let nudge = null;
      for (const c of botComments.reverse()) {
        const { data } = await github.request(
          "GET /repos/{owner}/{repo}/issues/comments/{id}",
          {
            owner,
            repo,
            id: c.databaseId,
          },
        );
        const state = parseMarker(data.body);
        if (state) {
          nudge = { id: c.databaseId, nudgedAt: state.nudgedAt };
          break;
        }
      }

      const facts = summarize(pr, requiredContexts, nudge);
      const decision = decide(facts, now);
      row.turn = facts.reasons.map((r) => r.kind).join(", ") || "—";
      row.age =
        decision.ageDays != null ? `${decision.ageDays.toFixed(1)}d` : "—";
      row.closeAt = decision.closeAt ? day(decision.closeAt) : "—";

      if (decision.action === "none") {
        row.outcome = decision.why;
      } else if (dryRun) {
        row.outcome = `would ${decision.action}`;
      } else if (decision.action === "nudge") {
        const body = nudgeBody(facts, decision, now);
        if (nudge) {
          await github.request(
            "PATCH /repos/{owner}/{repo}/issues/comments/{id}",
            {
              owner,
              repo,
              id: nudge.id,
              body,
            },
          );
        } else {
          await github.request(
            "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
            {
              owner,
              repo,
              issue_number: pr.number,
              body,
            },
          );
        }
        row.outcome = "nudged";
      } else {
        await github.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner,
            repo,
            issue_number: pr.number,
            body: closeBody(facts, decision),
          },
        );
        await github.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
          {
            owner,
            repo,
            issue_number: pr.number,
            labels: [STALE_LABEL],
          },
        );
        await github.request(
          "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
          {
            owner,
            repo,
            pull_number: pr.number,
            state: "closed",
          },
        );
        row.outcome = "closed";
      }
    } catch (error) {
      row.outcome = `FAILED: ${error.status ?? ""} ${error.message}`;
      row.failed = true;
    }
    log(`#${row.pr} ${row.author}: ${row.outcome}`);
    rows.push(row);
  }
  return rows;
}

module.exports = {
  DAYS,
  MARKER,
  parseMarker,
  summarize,
  decide,
  describeReasons,
  nudgeBody,
  closeBody,
  run,
};

// Local dry run through the gh CLI: node .github/scripts/pr-author-nudge.cjs [owner/repo]
if (require.main === module) {
  const { execFileSync } = require("node:child_process");
  const [owner, repo] = (process.argv[2] ?? "F3-Nation/f3-nation").split("/");
  const fill = (route, params) =>
    route.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key]));
  const gh = (args, input) =>
    JSON.parse(
      execFileSync("gh", args, {
        input,
        maxBuffer: 64 * 1024 * 1024,
      }).toString(),
    );
  const github = {
    graphql: (query, vars) => {
      const args = ["api", "graphql", "-f", `query=${query}`];
      for (const [k, v] of Object.entries(vars))
        if (v != null) args.push("-F", `${k}=${v}`);
      return gh(args).data;
    },
    request: async (route, params) => {
      const [method, path] = route.split(" ");
      if (method !== "GET")
        throw new Error(`local runs are dry runs only (${route})`);
      return { data: gh(["api", fill(path, params)]) };
    },
    paginate: async (route, params) =>
      gh(["api", "--paginate", fill(route.split(" ")[1], params)]),
  };
  run({ github, owner, repo, dryRun: true, log: () => {} })
    .then((rows) => {
      console.table(
        rows.map((r) => ({
          PR: `#${r.pr}`,
          author: r.author,
          "author's turn": r.turn,
          clock: r.age,
          "close on/after": r.closeAt,
          result: r.outcome,
        })),
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
