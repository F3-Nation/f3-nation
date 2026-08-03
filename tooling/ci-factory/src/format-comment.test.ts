import { describe, expect, it } from "vitest";

import { formatTriageComment, parseTriageResult } from "./format-comment";
import {
  loadTriagePhase1SystemPrompt,
  renderTriagePhase1UserPrompt,
} from "./load-prompt";

describe("load-prompt", () => {
  it("includes shared guardrails in the phase-1 system prompt", () => {
    const systemPrompt = loadTriagePhase1SystemPrompt();
    expect(systemPrompt).toContain("NEVER suggest weakening");
    expect(systemPrompt).toContain("Classify the failure as **exactly one**");
  });

  it("renders the user template with error and test context", () => {
    const userPrompt = renderTriagePhase1UserPrompt({
      errorContext: "Timeout waiting for selector",
      testSource: "test('browse', async () => { ... })",
      previewUrl: "https://pr-1-map.example.run.app",
    });

    expect(userPrompt).toContain("Timeout waiting for selector");
    expect(userPrompt).toContain("test('browse'");
    expect(userPrompt).toContain("https://pr-1-map.example.run.app");
  });
});

describe("parseTriageResult", () => {
  it("parses bare JSON model output", () => {
    const result = parseTriageResult(
      JSON.stringify({
        classification: "flake",
        confidence: "medium",
        human_review_required: false,
        summary: "Likely cold-start timeout.",
        evidence: ["Exceeded 30s navigation timeout on first load."],
        recommended_next_step: "Re-run the preview E2E job once.",
        retry_likely_to_pass: true,
      }),
    );

    expect(result.classification).toBe("flake");
    expect(result.retry_likely_to_pass).toBe(true);
  });

  it("parses JSON wrapped in markdown fences", () => {
    const result = parseTriageResult(`\`\`\`json
{
  "classification": "test-bug",
  "confidence": "high",
  "human_review_required": false,
  "summary": "Selector does not match the live DOM.",
  "evidence": ["Test expects role=heading name=Filters but snapshot shows none."],
  "recommended_next_step": "Update the test selector to match the current UI.",
  "retry_likely_to_pass": false
}
\`\`\``);

    expect(result.classification).toBe("test-bug");
  });

  const validTriage: Record<string, unknown> = {
    classification: "flake",
    confidence: "medium",
    human_review_required: false,
    summary: "Likely cold-start timeout.",
    evidence: ["Exceeded 30s navigation timeout on first load."],
    recommended_next_step: "Re-run the preview E2E job once.",
    retry_likely_to_pass: true,
  };

  it.each([
    [
      "invalid classification",
      { ...validTriage, classification: "not-a-class" },
      /Invalid classification/,
    ],
    [
      "invalid confidence",
      { ...validTriage, confidence: "certain" },
      /Invalid confidence/,
    ],
    ["empty evidence", { ...validTriage, evidence: [] }, /evidence must be/],
    [
      "non-boolean human_review_required",
      { ...validTriage, human_review_required: "yes" },
      /human_review_required must be a boolean/,
    ],
    [
      "non-boolean retry_likely_to_pass",
      { ...validTriage, retry_likely_to_pass: 1 },
      /retry_likely_to_pass must be a boolean/,
    ],
  ])("rejects %s", (_label, payload, message) => {
    expect(() => parseTriageResult(JSON.stringify(payload))).toThrow(message);
  });

  it("rejects input with no JSON object", () => {
    expect(() => parseTriageResult("no json here at all")).toThrow(
      /did not contain a JSON object/,
    );
  });
});

describe("formatTriageComment", () => {
  it("includes the triage marker and classification", () => {
    const comment = formatTriageComment({
      promptRevision: "abc1234",
      result: {
        classification: "app-bug",
        confidence: "high",
        human_review_required: true,
        summary: "Empty state copy does not match spec.",
        evidence: ["Rendered text lacks the filter hint described in AC-12."],
        recommended_next_step:
          "Fix the map empty-state copy or update the spec after human review.",
        retry_likely_to_pass: false,
      },
    });

    expect(comment).toContain("<!-- f3-ci-factory-triage -->");
    expect(comment).toContain("`app-bug`");
    expect(comment).toContain("Human review required");
    expect(comment).toContain("abc1234");
  });
});
