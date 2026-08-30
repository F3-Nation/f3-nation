"use strict";

/**
 * Pure logic for .github/workflows/ready-for-human-review-label.yml.
 * CommonJS because actions/github-script loads it with require().
 */

const LABEL = "ready for human review";

// Review-thread authors this workflow treats as "bot reviewers" for condition
// 3. Only these three are gated on -- a human reviewer's own unresolved
// threads never affect this label. The label triggers the *first* Codeowner
// review, at which point only bots have reviewed; checking every thread
// instead would pull the label the moment a Codeowner leaves their own
// review comment, which is backwards from what this label is for.
//
// These are bare logins with no `[bot]` suffix. That suffix is a REST/UI
// convention (`coderabbitai[bot]`) -- the workflow reads thread authors via
// GraphQL, where `Bot.login` never carries it (`coderabbitai`). Using the
// REST form here would silently match nothing and leave condition 3 always
// vacuously true.
//
// This list is not kept in sync automatically: if a review bot is added,
// removed, or its account changes, update it here by hand, or its threads
// go unnoticed by condition 3.
const BOT_LOGINS = [
  "coderabbitai",
  "greptile-apps",
  "qodo-free-for-open-source-projects",
];

// GitHub reports a skipped job's conclusion as "skipped", and a job-level
// `if:` that never runs a required job also lands here as "skipped" or
// "neutral" -- both merge like "success" per GitHub's own docs. No required
// context in this repo has a job-level `if:` today, so this is latent, but
// `pr-title.yml`'s "gate the step, not the job" comment exists precisely
// because a naive job-level skip would otherwise silently disagree with
// branch protection.
const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * Most recent (by id) check run or status matching `name` -- optionally also
 * matching `integrationId`, the GitHub App a ruleset pinned this context to.
 * A re-run creates a new, higher-numbered run rather than mutating the old
 * one, so "most recent" is "highest id" within the matching set.
 */
function latestRun(runs, name, integrationId) {
  return runs
    .filter(
      (run) =>
        run.name === name &&
        (integrationId == null || run.app?.id === integrationId),
    )
    .sort((a, b) => b.id - a.id)[0];
}

/**
 * True when every required context is satisfied by both the Checks API and
 * the legacy Commit Status API, evaluated independently -- GitHub requires
 * both to pass when a context has entries in both systems, so a passing
 * check run can't mask a failing status (or vice versa) the way merging the
 * two arrays before sorting by id would (check-run ids and status ids are
 * unrelated id spaces). A context with no matching run in either system --
 * never started -- is not green. `requiredContexts` entries carry
 * `integrationId` (nullable) so a same-named check from an unpinned or
 * different GitHub App can't satisfy a context the ruleset pinned to a
 * specific app; legacy statuses have no equivalent app-identity field to
 * check.
 */
function requiredChecksGreen(requiredContexts, checkRuns, statusRuns) {
  return requiredContexts.every(({ context, integrationId }) => {
    const check = latestRun(checkRuns, context, integrationId);
    const status = latestRun(statusRuns, context, null);
    if (!check && !status) return false;
    if (check && !PASSING_CONCLUSIONS.has(check.conclusion)) return false;
    if (status && status.conclusion !== "success") return false;
    return true;
  });
}

/**
 * True when every review thread whose first comment came from BOT_LOGINS is
 * resolved. A PR with no bot threads at all is vacuously clean: absence of a
 * thread is not the same as an unresolved one. Takes raw GraphQL
 * `reviewThreads` nodes (`{ isResolved, comments: { nodes: [{ author }] } }`)
 * so the caller doesn't need to know this module's internal shape.
 */
function botThreadsResolved(threads) {
  return threads
    .filter((thread) =>
      BOT_LOGINS.includes(thread.comments.nodes[0]?.author?.login),
    )
    .every((thread) => thread.isResolved);
}

module.exports = {
  LABEL,
  requiredChecksGreen,
  botThreadsResolved,
};
