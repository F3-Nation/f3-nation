import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const promptsDir = path.join(packageRoot, "prompts");

export function readPromptFile(relativePath: string): string {
  const filePath = path.join(promptsDir, relativePath);
  return readFileSync(filePath, "utf8").trim();
}

export function loadTriagePhase1SystemPrompt(): string {
  const guardrails = readPromptFile("shared.guardrails.md");
  const system = readPromptFile("triage-phase-1.system.md");
  return `${guardrails}\n\n${system}`;
}

export function renderTriagePhase1UserPrompt(args: {
  errorContext: string;
  testSource: string;
  previewUrl?: string;
}): string {
  const template = readPromptFile("triage-phase-1.user.template.md");
  const previewUrlSection = args.previewUrl
    ? `**Preview URL:** ${args.previewUrl}\n`
    : "";

  return fill(template, {
    PREVIEW_URL_SECTION: previewUrlSection,
    ERROR_CONTEXT: args.errorContext.trim(),
    TEST_SOURCE: args.testSource.trim(),
  });
}

/**
 * Adversarial review (F3-62 phase 1) prompt composition. All three roles
 * compose the shared guardrails exactly like triage does — the "never weaken
 * auth/validation" and "human-owned domains are flag-only" rules ride along
 * in every call.
 */
export type ReviewPromptRole = "reviewer-a" | "reviewer-b" | "judge";

export function loadReviewPhase1SystemPrompt(role: ReviewPromptRole): string {
  const guardrails = readPromptFile("shared.guardrails.md");
  const system = readPromptFile(`review-phase-1.${role}.system.md`);
  return `${guardrails}\n\n${system}`;
}

// Single pass over the ORIGINAL template: every {{KEY}} is resolved exactly
// once from `values`, so an injected artifact that itself contains `{{DIFF}}`
// can never be re-substituted on a later pass. The function replacer keeps
// `$`-sequences (`$&`/`$'`) in diffs/spec text literal, and unknown
// placeholders are left untouched.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    return value ?? match;
  });
}

export function renderReviewerAUserPrompt(args: {
  specs: string;
  diff: string;
}): string {
  return fill(readPromptFile("review-phase-1.reviewer-a.user.template.md"), {
    SPECS: args.specs.trim() || "(no spec files provided for this diff)",
    DIFF: args.diff.trim(),
  });
}

export function renderReviewerBUserPrompt(args: { diff: string }): string {
  return fill(readPromptFile("review-phase-1.reviewer-b.user.template.md"), {
    DIFF: args.diff.trim(),
  });
}

export function renderJudgeUserPrompt(args: {
  reviewerAFindings: string;
  reviewerBFindings: string;
  coderabbitComments: string;
}): string {
  return fill(readPromptFile("review-phase-1.judge.user.template.md"), {
    REVIEWER_A_FINDINGS: args.reviewerAFindings.trim(),
    REVIEWER_B_FINDINGS: args.reviewerBFindings.trim(),
    CODERABBIT_COMMENTS:
      args.coderabbitComments.trim() || "(no CodeRabbit comments on this PR)",
  });
}

export function getPromptPaths(): {
  guardrails: string;
  triageSystem: string;
  triageUserTemplate: string;
} {
  return {
    guardrails: path.join(promptsDir, "shared.guardrails.md"),
    triageSystem: path.join(promptsDir, "triage-phase-1.system.md"),
    triageUserTemplate: path.join(
      promptsDir,
      "triage-phase-1.user.template.md",
    ),
  };
}
