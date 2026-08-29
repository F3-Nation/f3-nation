/**
 * Phase-1 adversarial review for the CI factory (F3-62).
 *
 * Runs the A → B → judge chain: Reviewer A (spec-anchored, Anthropic top
 * tier) and Reviewer B (code-anchored, OpenAI top tier) review the diff
 * independently — neither sees the other's output — then a cheap-tier judge
 * merges, dedupes against CodeRabbit, ranks, caps, and tags the findings.
 * Prints (or writes) a PR-comment markdown body.
 *
 * Usage:
 *   pnpm -F @acme/ci-factory review \
 *     --diff /path/to/pr.diff \
 *     --specs /path/to/specs.md \
 *     --coderabbit /path/to/coderabbit-comments.txt \
 *     [--output comment.md] \
 *     [--head-sha <sha>] \
 *     [--truncation-note "diff truncated at 120KB"] \
 *     [--dry-run]
 *
 * Inference (skip with --dry-run) — all required, no defaults:
 *   CI_FACTORY_REVIEW_A_API_KEY / _BASE_URL / _MODEL   Reviewer A (Anthropic)
 *   CI_FACTORY_REVIEW_B_API_KEY / _BASE_URL / _MODEL   Reviewer B (OpenAI)
 *   CI_FACTORY_JUDGE_MODEL                             Judge (A's credentials)
 */
import { writeFileSync } from "node:fs";

import { flagValue, readRequiredFile } from "./cli-args";
import { getPromptRevision } from "./format-comment";
import {
  formatReviewComment,
  parseJudgeFindings,
  parseReviewerFindings,
} from "./format-review";
import { runChatCompletion } from "./inference";
import {
  loadReviewPhase1SystemPrompt,
  renderJudgeUserPrompt,
  renderReviewerAUserPrompt,
  renderReviewerBUserPrompt,
} from "./load-prompt";
import { getReviewInferenceConfigFromEnv } from "./review-config";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const diff = readRequiredFile("diff", flagValue("--diff"));
  if (!diff.trim()) {
    throw new Error("--diff file is empty; nothing to review");
  }
  // Specs and CodeRabbit inputs are required flags but may be empty files —
  // the workflow writes an empty specs file when the diff touches nothing
  // spec-covered, and CodeRabbit may simply not have commented yet.
  const specs = readRequiredFile("specs", flagValue("--specs"));
  const coderabbit = readRequiredFile("coderabbit", flagValue("--coderabbit"));
  const outputPath = flagValue("--output");
  const headSha = flagValue("--head-sha") ?? "unknown";
  const truncationNote = flagValue("--truncation-note");

  const reviewerASystem = loadReviewPhase1SystemPrompt("reviewer-a");
  const reviewerBSystem = loadReviewPhase1SystemPrompt("reviewer-b");
  const judgeSystem = loadReviewPhase1SystemPrompt("judge");
  const reviewerAUser = renderReviewerAUserPrompt({ specs, diff });
  const reviewerBUser = renderReviewerBUserPrompt({ diff });

  if (dryRun) {
    console.log("=== reviewer A system prompt ===");
    console.log(reviewerASystem);
    console.log("\n=== reviewer A user prompt ===");
    console.log(reviewerAUser);
    console.log("\n=== reviewer B system prompt ===");
    console.log(reviewerBSystem);
    console.log("\n=== reviewer B user prompt ===");
    console.log(reviewerBUser);
    console.log("\n=== judge system prompt ===");
    console.log(judgeSystem);
    return;
  }

  // Resolve all three configs up-front so a missing env var fails fast,
  // before any tokens are spent.
  const reviewerAConfig = getReviewInferenceConfigFromEnv("reviewer-a");
  const reviewerBConfig = getReviewInferenceConfigFromEnv("reviewer-b");
  const judgeConfig = getReviewInferenceConfigFromEnv("judge");

  // A and B are independent (neither sees the other's output), so run them
  // concurrently — the judge needs both before it can start anyway.
  console.log(
    `Running reviewers A (${reviewerAConfig.model}) and B (${reviewerBConfig.model}) in parallel...`,
  );
  const [rawA, rawB] = await Promise.all([
    runChatCompletion({
      config: reviewerAConfig,
      systemPrompt: reviewerASystem,
      userPrompt: reviewerAUser,
    }),
    runChatCompletion({
      config: reviewerBConfig,
      systemPrompt: reviewerBSystem,
      userPrompt: reviewerBUser,
    }),
  ]);
  const findingsA = parseReviewerFindings(rawA);
  const findingsB = parseReviewerFindings(rawB);
  console.log(
    `Reviewer A: ${findingsA.length} finding(s); Reviewer B: ${findingsB.length} finding(s).`,
  );

  console.log(`Running judge (${judgeConfig.model})...`);
  const rawJudge = await runChatCompletion({
    config: judgeConfig,
    systemPrompt: judgeSystem,
    userPrompt: renderJudgeUserPrompt({
      // Re-serialize the parsed findings so the judge sees canonical JSON,
      // not whatever fencing/prose surrounded the reviewer output.
      reviewerAFindings: JSON.stringify({ findings: findingsA }, null, 2),
      reviewerBFindings: JSON.stringify({ findings: findingsB }, null, 2),
      coderabbitComments: coderabbit,
    }),
  });
  const findings = parseJudgeFindings(rawJudge);
  console.log(`Judge kept ${findings.length} finding(s).`);

  const comment = formatReviewComment({
    findings,
    headSha,
    promptRevision: getPromptRevision(),
    models: {
      reviewerA: reviewerAConfig.model,
      reviewerB: reviewerBConfig.model,
      judge: judgeConfig.model,
    },
    truncationNote,
  });

  if (outputPath) {
    writeFileSync(outputPath, comment, "utf8");
    console.log(`Wrote PR review comment to ${outputPath}`);
  } else {
    console.log(comment);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
