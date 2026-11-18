"use strict";

/**
 * Logic for .github/workflows/pr-author-nudge.yml.
 *
 * Nudges, then closes, PRs that are waiting on their author. The clock runs
 * only while it's the author's turn under docs/PR_REVIEW_PROCESS.md: a
 * required check is failing, it conflicts with its base, a team member or a
 * bot has commented in an unresolved review thread since the author's last
 * reply, or a team member or a bot requested changes and nothing has been
 * pushed since. A draft gets a "draft" reason (shown in the job summary) but
 * is never nudged or closed: a draft is work in progress, not a PR waiting
 * on review. While the PR waits on bots or codeowners the clock doesn't run;
 * it restarts from the earliest open item (or the author's last activity, if
 * later). Any push, author comment, ready-for-review or reopen resets it. Bot
 * comments and reviewer pings don't.
 *
 * When a PR that was already reminded stops being the author's turn (or gets
 * `keep-open`), the run records `pausedAt` in the reminder's marker. The next
 * stretch starts after it, so an old reminder or heads-up never counts toward
 * a later close.
 *
 * About a day before a close, the run posts the PRs about to close to the
 * Codeowners Slack channel (one message per run, see `warnMessage()`), so a
 * codeowner can take one over the finish line or hold it with `keep-open`.
 * The warning is recorded in the nudge comment's marker, and the close waits
 * until it has been out at least WARN_MIN_MS.
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
// author is to the repo. Drafts are never nudged or closed. The close also needs
// a nudge posted at least (close - nudge) days earlier in the same stretch, so
// nobody is closed without that much warning.
const DAYS = {
  team: { nudge: 5, close: 10 }, // owners, members and collaborators
  outside: { nudge: 3, close: 7 }, // everyone else, including forks
};
// The codeowners' Slack heads-up goes out when the close is this close, and
// the close then waits until the heads-up has been out this long. 20h, not
// 24h, so a daily run that starts a little earlier than yesterday's still
// closes on schedule.
const WARN_LEAD_MS = DAY_MS;
const WARN_MIN_MS = 20 * 60 * 60 * 1000;
const TEAM_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// The most PRs one run nudges, warns about or closes. The first live run (or
// one after a long outage) would otherwise remind the whole backlog at once,
// and those PRs would then all close together. The PRs that have waited
// longest go first; the rest are held for a later run. docs/PR_REVIEW_PROCESS.md
// states these numbers, so update it when they change.
const MAX_PER_RUN = { nudge: 5, warn: 3, close: 3 };

// Authors whose PRs are never nudged, on top of every bot or app author.
// GraphQL logins carry no `[bot]` suffix.
const EXEMPT_AUTHORS = ["renovate", "f3-nation-release-please"];

const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const FAILING_STATES = new Set(["FAILURE", "ERROR"]);
// Required checks are read from this branch's rules; PRs into any other base
// are judged without them.
const DEFAULT_BRANCH = "main";
// A stalled Slack webhook fails the heads-up (retried next run) instead of
// holding the job.
const SLACK_TIMEOUT_MS = 30 * 1000;

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
 * `nudge` is `{ id, nudgedAt, warnedAt?, pausedAt?, body? }` for the bot's
 * newest reminder, or null. `writers` is an optional Set of logins with push
 * access, counted as team even when GitHub reports a private org member as
 * a CONTRIBUTOR.
 */
function summarize(pr, requiredContexts, nudge, writers = new Set()) {
  const author = pr.author?.login ?? null;
  const isTeam = (login, association) =>
    TEAM_ASSOCIATIONS.has(association) || writers.has(login);
  const isBotAuthor = pr.author?.__typename === "Bot";
  const created = ts(pr.createdAt);
  const timeline = pr.timelineItems?.nodes ?? [];

  let lastPush = null; // any push, by anyone: work is happening
  let lastAuthorActivity = created;
  let lastDraftStart = pr.isDraft ? created : null;
  let lastHandoff = created; // latest event that put the PR in front of someone
  const latestReviewByReviewer = new Map();

  const headCommit = pr.commits?.nodes?.[0]?.commit;
  const headOid = headCommit?.oid;
  let headForcePushedAt = null;
  for (const item of timeline) {
    switch (item.__typename) {
      case "HeadRefForcePushedEvent":
        lastPush = maxTs(lastPush, ts(item.createdAt));
        // GitHub's own record of when the current head arrived.
        if (item.afterCommit?.oid && item.afterCommit.oid === headOid)
          headForcePushedAt = maxTs(headForcePushedAt, ts(item.createdAt));
        break;
      case "ConvertToDraftEvent":
        lastDraftStart = maxTs(lastDraftStart, ts(item.createdAt));
        if (item.actor?.login === author)
          lastAuthorActivity = maxTs(lastAuthorActivity, ts(item.createdAt));
        break;
      case "ReadyForReviewEvent":
        // Draft time isn't the author's turn: whoever marks it ready, the
        // clock starts again from here.
        lastHandoff = maxTs(lastHandoff, ts(item.createdAt));
        lastAuthorActivity = maxTs(lastAuthorActivity, ts(item.createdAt));
        break;
      case "ReopenedEvent":
        // Whoever reopens it, a reopened PR starts a fresh clock.
        lastHandoff = maxTs(lastHandoff, ts(item.createdAt));
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
          // The author's own reviews. Their replies inside review threads
          // don't show up here; the thread loop below reads them.
          lastAuthorActivity = maxTs(lastAuthorActivity, at);
        } else if (who) {
          lastHandoff = maxTs(lastHandoff, at);
          // Only a team member's or a review bot's verdict puts it on the
          // author; a drive-by review from anyone else doesn't.
          const counts =
            isTeam(who, item.authorAssociation) ||
            item.author?.__typename === "Bot";
          if (
            counts &&
            item.state !== "COMMENTED" &&
            item.state !== "PENDING"
          ) {
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
  // Only a team member's or a bot's comment puts a thread on the author, the
  // same rule as for reviews: a drive-by commenter can't start the clock.
  const commentCounts = (comment) =>
    isTeam(comment.author?.login, comment.authorAssociation) ||
    comment.author?.__typename === "Bot";
  // A thread waits on the author from the first counted comment after their
  // last reply, so a bot commenting again in it doesn't move the clock.
  const waitingSince = (thread) => {
    const comments = thread.comments?.nodes ?? [];
    let start = null;
    for (const comment of comments) {
      if (comment.author?.login === author) start = null;
      else if (commentCounts(comment)) start ??= ts(comment.createdAt);
    }
    return start;
  };
  for (const thread of threads) {
    for (const comment of thread.comments?.nodes ?? []) {
      if (comment.author?.login === author)
        lastAuthorActivity = maxTs(lastAuthorActivity, ts(comment.createdAt));
    }
  }
  const contexts = headCommit?.statusCheckRollup?.contexts?.nodes ?? [];
  // GitHub keeps no push time for an ordinary push, and a commit's date is
  // whatever its author set: a commit dated 2099 would hold the PR open
  // forever. GitHub's own clock is used instead: the first check suite or CI
  // run on the head commit, created when it reached GitHub (fork PRs waiting
  // on workflow approval get suites too), the first legacy status on it, or
  // the force-push that brought it. Commit dates never count. A head commit
  // with none of these (a `[skip ci]` push, say) may have just been pushed,
  // so `decide()` won't warn about or close that PR until one shows up.
  const headArrival = minTs(
    ...(headCommit?.checkSuites?.nodes ?? []).map((s) => ts(s.createdAt)),
    ...contexts
      .filter((c) => c.__typename === "CheckRun")
      .map((c) => ts(c.startedAt)),
    ...contexts
      .filter((c) => c.__typename === "StatusContext")
      .map((c) => ts(c.createdAt)),
    headForcePushedAt,
  );
  lastPush = maxTs(lastPush, headArrival);
  lastAuthorActivity = maxTs(lastAuthorActivity, lastPush);

  const reasons = [];

  if (pr.isDraft) {
    reasons.push({ kind: "draft", since: lastDraftStart ?? created });
  }

  const failing = [];
  let failingSince = null;
  for (const name of requiredContexts) {
    // The newest check run and the newest legacy status are judged apart, so
    // a pass in one API can't hide a failure in the other.
    const latest = ["CheckRun", "StatusContext"].map(
      (kind) =>
        contexts
          .filter(
            (c) => c.__typename === kind && (c.name ?? c.context) === name,
          )
          .map((c) => ({
            failed:
              kind === "CheckRun"
                ? FAILING_CONCLUSIONS.has(c.conclusion)
                : FAILING_STATES.has(c.state),
            at: ts(c.completedAt ?? c.createdAt),
            // A rerun still in progress has no completion time yet, so runs
            // are ordered by when they started.
            order: ts(c.startedAt ?? c.completedAt ?? c.createdAt),
          }))
          .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0],
    );
    const failed = latest.filter((r) => r?.failed);
    if (failed.length) {
      failing.push(name);
      failingSince = minTs(failingSince, ...failed.map((r) => r.at));
    }
  }
  if (!pr.isDraft && failing.length) {
    reasons.push({ kind: "checks", since: failingSince, names: failing });
  }

  if (!pr.isDraft && pr.mergeable === "CONFLICTING") {
    // GitHub records no time for a conflict appearing; the latest handoff is
    // the closest honest stand-in, and the close still waits on a nudge.
    reasons.push({
      kind: "conflict",
      since: lastHandoff,
      base: pr.baseRefName ?? DEFAULT_BRANCH,
    });
  }

  const waitingThreads = threads.filter(
    (thread) => !thread.isResolved && waitingSince(thread) != null,
  );
  if (!pr.isDraft && waitingThreads.length) {
    reasons.push({
      kind: "threads",
      since: minTs(...waitingThreads.map(waitingSince)),
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
    tier: isTeam(author, pr.authorAssociation) ? "team" : "outside",
    // A deleted ("ghost") account has no author to remind; a codeowner picks
    // those up instead.
    exempt:
      author == null ||
      isBotAuthor ||
      EXEMPT_AUTHORS.includes(author) ||
      labels.includes(KEEP_OPEN_LABEL),
    reasons,
    lastAuthorActivity,
    pushTimeKnown: headArrival != null,
    nudge,
  };
}

/**
 * What to do with one summarized PR at time `now` (ms):
 * `{ action: "none" | "nudge" | "warn" | "close", why, clockStart, ageDays,
 * closeAt }`. "warn" is the codeowners' Slack heads-up a day before the close.
 */
function decide(facts, now) {
  if (facts.exempt) return { action: "none", why: "exempt" };
  // Work in progress: the author isn't keeping anyone waiting.
  if (facts.isDraft) return { action: "none", why: "draft" };
  if (!facts.reasons.length)
    return { action: "none", why: "not author's turn" };

  const days = DAYS[facts.tier];
  const turnStart = minTs(...facts.reasons.map((r) => r.since));
  // A recorded pause ends the stretch the old reminder belonged to.
  const clockStart = maxTs(
    turnStart,
    facts.lastAuthorActivity,
    ts(facts.nudge?.pausedAt),
  );
  const ageDays = (now - clockStart) / DAY_MS;
  const nudgedAt = ts(facts.nudge?.nudgedAt);
  const nudgedThisStretch = nudgedAt != null && nudgedAt >= clockStart;
  const warnedAt = ts(facts.nudge?.warnedAt);
  const warnedThisStretch =
    nudgedThisStretch && warnedAt != null && warnedAt >= nudgedAt;
  const closeAt = nudgedThisStretch
    ? Math.max(
        clockStart + days.close * DAY_MS,
        nudgedAt + (days.close - days.nudge) * DAY_MS,
        warnedThisStretch ? warnedAt + WARN_MIN_MS : 0,
      )
    : null;

  // The head commit's push time is unknown, so the author may have pushed
  // since: no heads-up or close. Reminders still go out; a push or comment
  // from the author answers them.
  const holdClose = facts.pushTimeKnown === false && nudgedThisStretch;
  if (holdClose && now >= closeAt - WARN_LEAD_MS) {
    return {
      action: "none",
      why: "push time unknown",
      clockStart,
      ageDays,
      closeAt,
    };
  }
  if (
    nudgedThisStretch &&
    !warnedThisStretch &&
    now >= closeAt - WARN_LEAD_MS
  ) {
    return {
      action: "warn",
      why: "author's turn",
      clockStart,
      ageDays,
      // The earliest a close can follow this heads-up, as the close sees it.
      closeAt: Math.max(closeAt, now + WARN_MIN_MS),
    };
  }
  if (warnedThisStretch && now >= closeAt) {
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
      case "checks":
        return `Required ${r.names.length === 1 ? "check" : "checks"} failing: ${r.names.map((n) => `\`${n}\``).join(", ")}.`;
      case "conflict":
        return `It has a merge conflict with \`${r.base ?? DEFAULT_BRANCH}\`.`;
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

// Slack mrkdwn needs &, < and > escaped in anything user-written.
const slackEscape = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Rewrites the state in the bot's marker, keeping the rest of the comment. */
function withState(body, state) {
  return body.replace(
    /<!-- pr-author-nudge (\{.*?\})? ?-->/,
    `${MARKER} ${JSON.stringify(state)} -->`,
  );
}

/**
 * The Codeowners Slack heads-up for PRs about to close, or null when none
 * are. `warns` are summary rows (pr, title, author, age, turn, closeAt).
 */
function warnMessage(warns, { owner, repo }) {
  if (!warns.length) return null;
  const lines = warns.map((r) => {
    const url = `https://github.com/${owner}/${repo}/pull/${r.pr}`;
    const link = `<${url}|#${r.pr} ${slackEscape(r.title ?? "")}>`;
    const who = slackEscape(r.author ?? "unknown");
    const status = `waiting on them ${r.age} (${r.turn}), closes on/after ${r.closeAt}`;
    return `• ${link} by ${who}: ${status}`;
  });
  return [
    `:hourglass: ${warns.length === 1 ? "This PR" : `These ${warns.length} PRs`} will auto-close in about a day. ${warns.length === 1 ? "It has" : "They have"} been waiting on the author since the reminder:`,
    ...lines,
    "",
    "To take one over the finish line, push to its branch or add the `keep-open` label. Otherwise it closes, and the author or any of us can reopen it later.",
  ].join("\n");
}

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
    `Closing this PR: it has waited on @${facts.author} for ${plural(Math.floor(decision.ageDays), "day")}, with nothing changed since the reminder above.`,
    "",
    "Reopen it whenever you pick it back up. A maintainer may also finish the work in a new PR and credit you with a `Co-authored-by` trailer.",
  ].join("\n");
}

// Ten PRs per page: each pulls its timeline, threads and checks, and bigger
// pages risk GitHub's ~10s GraphQL limit (same finding as scripts/pr-triage.sh).
const PAGE_SIZE = 10;
const PR_FIELDS = `
  number url title isDraft createdAt mergeable authorAssociation baseRefName
  author { login __typename }
  labels(first: 30) { nodes { name } }
  timelineItems(last: 100, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT,
      READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REOPENED_EVENT, ISSUE_COMMENT,
      PULL_REQUEST_REVIEW]) {
    nodes {
      __typename
      ... on HeadRefForcePushedEvent { createdAt afterCommit { oid } }
      ... on ReadyForReviewEvent { createdAt actor { login } }
      ... on ConvertToDraftEvent { createdAt actor { login } }
      ... on ReopenedEvent { createdAt actor { login } }
      ... on IssueComment { databaseId createdAt author { login } }
      ... on PullRequestReview { submittedAt state authorAssociation author { login __typename } }
    }
  }
  reviewThreads(first: 100) {
    nodes { isResolved comments(last: 20) { nodes {
      createdAt authorAssociation author { login __typename }
    } } }
  }
  commits(last: 1) {
    nodes { commit {
      oid
      checkSuites(first: 20) { nodes { createdAt } }
      statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name conclusion startedAt completedAt }
        ... on StatusContext { context state createdAt }
      } } }
    } }
  }`;

/**
 * Reads what `summarize()` needs for every open PR: the PR nodes, the required
 * checks on the default branch, and who has push access. Writes nothing.
 * Returns `{ prs, factsFor(pr, nudge = null), writersKnown, notes }`, where
 * `notes` are warnings for the workflow log. Exported so every report that
 * asks whose turn a PR is answers it with the same rules as the nudge.
 *
 * `base` (`{ owner, repo }`, default the PR repo) is where the branch rules and
 * the team are read. A security advisory's temporary private fork has neither
 * of its own: its PRs merge into the advisory's repo, under that repo's rules.
 */
async function collectFacts({ github, owner, repo, base = { owner, repo } }) {
  const rules = await github.paginate(
    "GET /repos/{owner}/{repo}/rules/branches/{branch}",
    {
      owner: base.owner,
      repo: base.repo,
      branch: DEFAULT_BRANCH,
      per_page: 100,
    },
  );
  const requiredContexts = rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c.context);

  // Everyone with push access counts as team. GitHub can report a private
  // org member as a CONTRIBUTOR to the workflow's token, so the association
  // alone would give them the outside timings.
  const notes = [];
  let writers = new Set();
  let writersKnown = true;
  try {
    const collaborators = await github.paginate(
      "GET /repos/{owner}/{repo}/collaborators",
      {
        owner: base.owner,
        repo: base.repo,
        affiliation: "all",
        permission: "push",
        per_page: 100,
      },
    );
    writers = new Set(collaborators.map((c) => c.login));
  } catch (error) {
    writersKnown = false;
    notes.push(
      `Couldn't list collaborators (${error.status ?? ""} ${error.message}); ` +
        "authors who might be team are judged as outside contributors.",
    );
  }

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

  const factsFor = (pr, nudge = null) =>
    summarize(
      pr,
      (pr.baseRefName ?? DEFAULT_BRANCH) === DEFAULT_BRANCH
        ? requiredContexts
        : [],
      nudge,
      writers,
    );
  return { prs, factsFor, writersKnown, notes };
}

/**
 * Fetches every open PR, decides, and (unless dryRun) comments, closes and
 * labels. `github` is actions/github-script's client (or the gh shim below).
 * `notify(text)` posts the codeowners' Slack heads-up. Without it a live run
 * treats the heads-up as failed: nothing is recorded, the closes wait, and the
 * rows fail. `limits` caps the nudges, heads-ups and closes in one run
 * (MAX_PER_RUN by default); dry runs count against it too, so their report
 * matches what a live run would do; an action left out of `limits` keeps its
 * default. Returns `{ rows, slackNote, slackSent, notes }`: the job summary
 * rows, the heads-up text, whether it reached Slack, and warnings for the
 * workflow log.
 */
async function run({
  github,
  owner,
  repo,
  dryRun,
  now = Date.now(),
  botLogin = "github-actions",
  log = console.log,
  notify = null,
  limits = MAX_PER_RUN,
}) {
  const { prs, factsFor, writersKnown, notes } = await collectFacts({
    github,
    owner,
    repo,
  });
  if (!writersKnown)
    notes.push(
      "No heads-ups or closes for authors who might be team until collaborators can be listed.",
    );

  // First read and decide every PR, so the per-run limits go to the PRs that
  // have waited longest; then act.
  const entries = [];
  for (const pr of prs) {
    const row = {
      pr: pr.number,
      title: pr.title,
      author: pr.author?.login,
      outcome: "",
    };
    try {
      // Only the bot's own comments are fetched with bodies, to find its marker.
      const botComments = (pr.timelineItems?.nodes ?? []).filter(
        (n) => n.__typename === "IssueComment" && n.author?.login === botLogin,
      );
      // The newest reminder holds the current state.
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
          nudge = {
            id: c.databaseId,
            nudgedAt: state.nudgedAt,
            warnedAt: state.warnedAt,
            pausedAt: state.pausedAt,
            body: data.body,
          };
          break;
        }
      }

      const facts = factsFor(pr, nudge);
      row.tier = facts.tier;
      const decision = decide(facts, now);
      row.turn = facts.reasons.map((r) => r.kind).join(", ") || "—";
      row.age =
        decision.ageDays != null ? `${decision.ageDays.toFixed(1)}d` : "—";
      row.closeAt = decision.closeAt ? day(decision.closeAt) : "—";

      const nudgedAt = ts(nudge?.nudgedAt);
      const pausedAt = ts(nudge?.pausedAt);
      const pause =
        decision.action === "none" &&
        ["not author's turn", "exempt", "draft"].includes(decision.why) &&
        // Paused even while mergeability is UNKNOWN: if it turns out to be a
        // conflict, the cost is a repeat reminder; not pausing could let an
        // old reminder close the PR.
        nudgedAt != null &&
        (pausedAt == null || pausedAt < nudgedAt);
      entries.push({ pr, row, facts, decision, nudge, pause });
    } catch (error) {
      row.outcome = `FAILED: ${error.status ?? ""} ${error.message}`;
      row.failed = true;
      entries.push({ pr, row });
    }
  }

  // Outside-tier heads-ups and closes are held anyway while collaborators are
  // unknown, so they don't take a slot.
  const heldUnknown = (e) =>
    !writersKnown &&
    e.facts.tier === "outside" &&
    (e.decision.action === "warn" || e.decision.action === "close");
  for (const action of Object.keys(MAX_PER_RUN)) {
    const limit = limits[action] ?? MAX_PER_RUN[action];
    entries
      .filter(
        (e) => !e.row.failed && e.decision.action === action && !heldUnknown(e),
      )
      .sort((a, b) => a.decision.clockStart - b.decision.clockStart)
      .slice(limit)
      .forEach((e) => {
        e.overLimit = limit;
      });
  }

  const rows = [];
  const warns = [];
  for (const { pr, row, facts, decision, nudge, pause, overLimit } of entries) {
    rows.push(row);
    if (row.failed) {
      log(`#${row.pr} ${row.author}: ${row.outcome}`);
      continue;
    }
    try {
      if (pause) {
        // Once per stretch: the old reminder and heads-up stop counting.
        row.outcome = dryRun ? `${decision.why}, would pause` : decision.why;
        if (!dryRun) {
          await github.request(
            "PATCH /repos/{owner}/{repo}/issues/comments/{id}",
            {
              owner,
              repo,
              id: nudge.id,
              body: withState(nudge.body, {
                nudgedAt: nudge.nudgedAt,
                warnedAt: nudge.warnedAt,
                pausedAt: new Date(now).toISOString(),
              }),
            },
          );
          row.outcome = `${decision.why}, paused`;
        }
      } else if (decision.action === "none") {
        row.outcome = decision.why;
      } else if (heldUnknown({ facts, decision })) {
        // The author may be a private org member with team timings, so the
        // shorter outside deadline can't be trusted. Held, retried next run.
        row.outcome = `FAILED: ${decision.action} held, collaborators unknown`;
        row.failed = true;
      } else if (overLimit != null) {
        // Not a failure: the next run picks it up, oldest first.
        row.outcome = `${decision.action} held for a later run (limit ${overLimit} per run)`;
      } else if (dryRun) {
        row.outcome = `would ${decision.action}`;
        if (decision.action === "warn") warns.push(row);
      } else if (decision.action === "warn") {
        // Sent together after the loop, then recorded in each marker.
        row.outcome = "warning";
        row.nudge = nudge;
        warns.push(row);
      } else if (decision.action === "nudge") {
        // Always a new comment: editing an old one wouldn't notify the author.
        await github.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner,
            repo,
            issue_number: pr.number,
            body: nudgeBody(facts, decision, now),
          },
        );
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
    if (row.outcome !== "warning")
      log(`#${row.pr} ${row.author}: ${row.outcome}`);
  }

  const slackNote = warnMessage(warns, { owner, repo });
  let slackSent = false;
  if (slackNote && !dryRun) {
    let error = notify ? null : new Error("no Slack webhook is configured");
    if (notify) {
      try {
        await notify(slackNote);
        slackSent = true;
      } catch (e) {
        error = e;
      }
    }
    for (const row of warns) {
      const { nudge } = row;
      delete row.nudge;
      if (error) {
        // Not recorded, so the next run warns again and the close waits.
        row.outcome = `FAILED: Slack heads-up: ${error.message}`;
        row.failed = true;
      } else {
        try {
          await github.request(
            "PATCH /repos/{owner}/{repo}/issues/comments/{id}",
            {
              owner,
              repo,
              id: nudge.id,
              body: withState(nudge.body, {
                nudgedAt: nudge.nudgedAt,
                warnedAt: new Date(now).toISOString(),
              }),
            },
          );
          row.outcome = "warned in Slack";
        } catch (e) {
          row.outcome = `FAILED: ${e.status ?? ""} ${e.message}`;
          row.failed = true;
        }
      }
      log(`#${row.pr} ${row.author}: ${row.outcome}`);
    }
  }
  return { rows, slackNote, slackSent, notes };
}

module.exports = {
  DAYS,
  DAY_MS,
  MAX_PER_RUN,
  SLACK_TIMEOUT_MS,
  MARKER,
  parseMarker,
  slackEscape,
  collectFacts,
  summarize,
  decide,
  describeReasons,
  nudgeBody,
  closeBody,
  warnMessage,
  withState,
  run,
};

// Local dry run through the gh CLI: node .github/scripts/pr-author-nudge.cjs [owner/repo]
if (require.main === module) {
  const { createGhClient } = require("./gh-local-client.cjs");
  const [owner, repo] = (process.argv[2] ?? "F3-Nation/f3-nation").split("/");
  const github = createGhClient();
  run({ github, owner, repo, dryRun: true, log: () => {} })
    .then(({ rows, slackNote, notes }) => {
      for (const note of notes) console.warn(note);
      if (slackNote) console.log(`Slack heads-up (not sent):\n${slackNote}\n`);
      console.table(
        rows.map((r) => ({
          PR: `#${r.pr}`,
          author: r.author,
          timing: r.tier,
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
