/**
 * Phase-1 E2E failure triage for the CI factory (F3-61).
 *
 * Loads versioned prompts from tooling/ci-factory/prompts/, calls an
 * OpenAI-compatible inference endpoint, and prints a PR-comment markdown body.
 *
 * Usage:
 *   pnpm -F @acme/ci-factory triage \
 *     --error-context /path/to/error.txt \
 *     --test-source apps/map/tests/e2e/browse.spec.ts \
 *     [--preview-url https://pr-123-map-....run.app] \
 *     [--output comment.md] \
 *     [--dry-run]
 *
 * Inference (skip with --dry-run):
 *   CI_FACTORY_INFERENCE_API_KEY          required
 *   CI_FACTORY_INFERENCE_BASE_URL         required (e.g. https://api.anthropic.com/v1)
 *   CI_FACTORY_INFERENCE_MODEL            required (e.g. claude-haiku-4-5-20251001)
 *   CI_FACTORY_INFERENCE_JSON_MODE        optional; "1" requests JSON mode
 */
import { readFileSync, writeFileSync } from "node:fs";

import { flagValue, readRequiredFile } from "./cli-args";
import {
  formatTriageComment,
  getPromptRevision,
  parseTriageResult,
} from "./format-comment";
import { getInferenceConfigFromEnv, runChatCompletion } from "./inference";
import {
  loadTriagePhase1SystemPrompt,
  renderTriagePhase1UserPrompt,
} from "./load-prompt";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const errorContext = readRequiredFile(
    "error-context",
    flagValue("--error-context"),
  );
  const testSourcePath = flagValue("--test-source");
  if (!testSourcePath) {
    throw new Error("Missing required flag: --test-source <path>");
  }
  const testSource = readFileSync(testSourcePath, "utf8");
  const previewUrl = flagValue("--preview-url");
  const outputPath = flagValue("--output");

  const systemPrompt = loadTriagePhase1SystemPrompt();
  const userPrompt = renderTriagePhase1UserPrompt({
    errorContext,
    testSource,
    previewUrl,
  });

  if (dryRun) {
    console.log("=== system prompt ===");
    console.log(systemPrompt);
    console.log("\n=== user prompt ===");
    console.log(userPrompt);
    return;
  }

  // Throws with the exact missing variable names; pass --dry-run to print
  // prompts without calling inference.
  const inferenceConfig = getInferenceConfigFromEnv();

  console.log("Running phase-1 triage inference...");
  const raw = await runChatCompletion({
    config: inferenceConfig,
    systemPrompt,
    userPrompt,
    // Deterministic classification on the cheap tier (Haiku accepts it;
    // top-tier models reject sampling params — the review CLI omits it).
    temperature: 0,
  });

  const result = parseTriageResult(raw);
  const comment = formatTriageComment({
    result,
    promptRevision: getPromptRevision(),
  });

  if (outputPath) {
    writeFileSync(outputPath, comment, "utf8");
    console.log(`Wrote PR comment to ${outputPath}`);
  } else {
    console.log(comment);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
