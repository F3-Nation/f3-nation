import { sanitizeForComment } from "./sanitize";

export interface TriageResult {
  classification: "app-bug" | "test-bug" | "spec-mismatch" | "flake" | "infra";
  confidence: "high" | "medium" | "low";
  human_review_required: boolean;
  summary: string;
  evidence: string[];
  recommended_next_step: string;
  retry_likely_to_pass: boolean;
}

const CLASSIFICATIONS = new Set<TriageResult["classification"]>([
  "app-bug",
  "test-bug",
  "spec-mismatch",
  "flake",
  "infra",
]);

const CONFIDENCE_LEVELS = new Set<TriageResult["confidence"]>([
  "high",
  "medium",
  "low",
]);

export function parseTriageResult(raw: string): TriageResult {
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as Partial<TriageResult>;

  if (!parsed.classification || !CLASSIFICATIONS.has(parsed.classification)) {
    throw new Error(`Invalid classification: ${String(parsed.classification)}`);
  }
  if (!parsed.confidence || !CONFIDENCE_LEVELS.has(parsed.confidence)) {
    throw new Error(`Invalid confidence: ${String(parsed.confidence)}`);
  }
  if (typeof parsed.human_review_required !== "boolean") {
    throw new Error("human_review_required must be a boolean");
  }
  if (!parsed.summary || typeof parsed.summary !== "string") {
    throw new Error("summary must be a non-empty string");
  }
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length === 0) {
    throw new Error("evidence must be a non-empty string array");
  }
  if (
    !parsed.recommended_next_step ||
    typeof parsed.recommended_next_step !== "string"
  ) {
    throw new Error("recommended_next_step must be a non-empty string");
  }
  if (typeof parsed.retry_likely_to_pass !== "boolean") {
    throw new Error("retry_likely_to_pass must be a boolean");
  }

  return {
    classification: parsed.classification,
    confidence: parsed.confidence,
    human_review_required: parsed.human_review_required,
    summary: parsed.summary,
    evidence: parsed.evidence.map(String),
    recommended_next_step: parsed.recommended_next_step,
    retry_likely_to_pass: parsed.retry_likely_to_pass,
  };
}

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model output did not contain a JSON object");
  }
  return trimmed.slice(start, end + 1);
}

export const TRIAGE_COMMENT_MARKER = "<!-- f3-ci-factory-triage -->";

export function formatTriageComment(args: {
  result: TriageResult;
  promptRevision: string;
}): string {
  const { result, promptRevision } = args;
  const humanReview = result.human_review_required
    ? "Yes — security, availability, or scalability may be involved."
    : "No";

  // summary / evidence / next-step are free-text model output derived from
  // PR-controlled input, so neutralize @mentions, issue autolinks, and raw
  // HTML before interpolating them into the comment. classification /
  // confidence are validated enums rendered inside backticks (already inert).
  const evidence = result.evidence
    .map((item) => `- ${sanitizeForComment(item)}`)
    .join("\n");

  return `${TRIAGE_COMMENT_MARKER}
### CI factory triage (phase 1)

**Classification:** \`${result.classification}\` (${result.confidence} confidence)

${sanitizeForComment(result.summary)}

**Evidence**
${evidence}

**Recommended next step:** ${sanitizeForComment(result.recommended_next_step)}

**Retry likely to pass:** ${result.retry_likely_to_pass ? "yes" : "no"}

**Human review required:** ${humanReview}

> Phase 1 is analysis only — this comment does not open or apply code changes.

_Prompt revision: \`${promptRevision}\`_
`;
}

export function getPromptRevision(): string {
  return process.env.GITHUB_SHA?.slice(0, 7) ?? "local";
}
