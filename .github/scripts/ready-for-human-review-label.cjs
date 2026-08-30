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
const BOT_LOGINS = [
  "coderabbitai",
  "greptile-apps",
  "qodo-free-for-open-source-projects",
];

/**
 * True when every required context's most recent check run (by run id, since
 * a re-run creates a new, higher-numbered run rather than mutating the old
 * one) concluded in success. A context with no matching run at all -- never
 * started -- is not green.
 */
function requiredChecksGreen(requiredContexts, checkRuns) {
  return requiredContexts.every((contextName) => {
    const runs = checkRuns
      .filter((run) => run.name === contextName)
      .sort((a, b) => b.id - a.id);
    return runs[0]?.conclusion === "success";
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
