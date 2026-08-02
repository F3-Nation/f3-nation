import { describe, expect, it } from "vitest";

import type { JudgeFinding } from "./format-review";
import {
  formatReviewComment,
  MAX_JUDGE_FINDINGS,
  parseJudgeFindings,
  parseReviewerFindings,
  REVIEW_COMMENT_MARKER,
} from "./format-review";
import {
  loadReviewPhase1SystemPrompt,
  renderJudgeUserPrompt,
  renderReviewerAUserPrompt,
  renderReviewerBUserPrompt,
} from "./load-prompt";

const reviewerFinding = {
  file: "packages/api/src/router/location.ts",
  line_hint: "crupdate procedure (~line 322)",
  severity: "high",
  claim:
    "The crupdate mutation was downgraded from editorProcedure to publicProcedure.",
  evidence:
    'Spec: "crupdate requires editor". Diff: "- editorProcedure / + publicProcedure".',
  suggestion_or_flag:
    "FLAG: RBAC change — a human must verify the authorization table.",
};

const judgeFinding: JudgeFinding = {
  ...reviewerFinding,
  severity: "high",
  tag: "A+B",
  human_review_required: true,
};

describe("review prompt composition", () => {
  it("includes shared guardrails in every role's system prompt", () => {
    for (const role of ["reviewer-a", "reviewer-b", "judge"] as const) {
      const systemPrompt = loadReviewPhase1SystemPrompt(role);
      expect(systemPrompt).toContain("NEVER suggest weakening");
      expect(systemPrompt).toContain("FLAGGED for human review only");
    }
    expect(loadReviewPhase1SystemPrompt("reviewer-a")).toContain(
      "RBAC-table contradictions",
    );
    expect(loadReviewPhase1SystemPrompt("reviewer-b")).toContain(
      "Performance footguns",
    );
    expect(loadReviewPhase1SystemPrompt("judge")).toContain(
      "Cap at 8 findings",
    );
  });

  it("renders reviewer A's user prompt with specs and diff", () => {
    const prompt = renderReviewerAUserPrompt({
      specs: "## Map spec\nAC-1: markers cluster",
      diff: "-  crupdate: editorProcedure\n+  crupdate: publicProcedure",
    });
    expect(prompt).toContain("AC-1: markers cluster");
    expect(prompt).toContain("+  crupdate: publicProcedure");
  });

  it("renders a placeholder when no specs apply", () => {
    expect(renderReviewerAUserPrompt({ specs: "  ", diff: "+ x" })).toContain(
      "(no spec files provided for this diff)",
    );
  });

  it("keeps dollar-sequences in the diff literal", () => {
    // String.replace treats $' specially in string replacements; a diff
    // containing it must survive template filling verbatim.
    const diff = "+ const cost = `$'{amount}`; // $& $`";
    expect(renderReviewerBUserPrompt({ diff })).toContain(diff);
  });

  it("renders the judge prompt with both findings and a CodeRabbit placeholder", () => {
    const prompt = renderJudgeUserPrompt({
      reviewerAFindings: '{"findings": ["a"]}',
      reviewerBFindings: '{"findings": ["b"]}',
      coderabbitComments: "",
    });
    expect(prompt).toContain('{"findings": ["a"]}');
    expect(prompt).toContain('{"findings": ["b"]}');
    expect(prompt).toContain("(no CodeRabbit comments on this PR)");
  });
});

describe("parseReviewerFindings", () => {
  it("parses bare JSON output", () => {
    const findings = parseReviewerFindings(
      JSON.stringify({ findings: [reviewerFinding] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("high");
  });

  it("parses JSON wrapped in markdown fences and accepts empty findings", () => {
    expect(parseReviewerFindings('```json\n{"findings": []}\n```')).toEqual([]);
  });

  it("rejects output without a findings array", () => {
    expect(() => parseReviewerFindings('{"ok": true}')).toThrow(
      /findings.*array/,
    );
  });

  it("rejects an invalid severity", () => {
    expect(() =>
      parseReviewerFindings(
        JSON.stringify({
          findings: [{ ...reviewerFinding, severity: "critical" }],
        }),
      ),
    ).toThrow(/severity is invalid: critical/);
  });
});

describe("parseJudgeFindings", () => {
  it("parses a tagged, flagged finding", () => {
    const findings = parseJudgeFindings(
      JSON.stringify({ findings: [judgeFinding] }),
    );
    expect(findings[0]?.tag).toBe("A+B");
    expect(findings[0]?.human_review_required).toBe(true);
  });

  it("rejects an invalid tag", () => {
    expect(() =>
      parseJudgeFindings(
        JSON.stringify({ findings: [{ ...judgeFinding, tag: "C" }] }),
      ),
    ).toThrow(/tag is invalid: C/);
  });

  it("rejects a missing human_review_required boolean", () => {
    expect(() =>
      parseJudgeFindings(
        JSON.stringify({
          findings: [{ ...judgeFinding, human_review_required: "yes" }],
        }),
      ),
    ).toThrow(/human_review_required must be a boolean/);
  });

  it("re-sorts by severity and enforces the cap defensively", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...judgeFinding,
      human_review_required: false,
      severity: i === 11 ? "high" : "low",
      claim: `finding ${i}`,
    }));
    const findings = parseJudgeFindings(JSON.stringify({ findings: many }));

    expect(findings).toHaveLength(MAX_JUDGE_FINDINGS);
    expect(findings[0]?.severity).toBe("high");
  });
});

describe("formatReviewComment", () => {
  const models = {
    reviewerA: "claude-opus-4-8",
    reviewerB: "gpt-5.5",
    judge: "claude-haiku-4-5-20251001",
  };

  it("renders the marker, head SHA, tags, and human-review flag", () => {
    const comment = formatReviewComment({
      findings: [judgeFinding],
      headSha: "abc1234def",
      promptRevision: "abc1234",
      models,
    });

    expect(comment).toContain(REVIEW_COMMENT_MARKER);
    expect(comment).toContain("abc1234def");
    expect(comment).toContain("`[A+B]`");
    expect(comment).toContain("Human review required");
    expect(comment).toContain("claude-opus-4-8");
    expect(comment).toContain("gpt-5.5");
  });

  it("renders a clean-diff body when there are no findings", () => {
    const comment = formatReviewComment({
      findings: [],
      headSha: "abc1234def",
      promptRevision: "local",
      models,
    });

    expect(comment).toContain(REVIEW_COMMENT_MARKER);
    expect(comment).toContain("No findings survived the merge");
  });

  it("includes the truncation note when provided", () => {
    const comment = formatReviewComment({
      findings: [],
      headSha: "abc1234def",
      promptRevision: "local",
      models,
      truncationNote: "Diff truncated at 120KB.",
    });

    expect(comment).toContain("Diff truncated at 120KB.");
  });

  it("escapes pipes and newlines so the findings table stays intact", () => {
    const comment = formatReviewComment({
      findings: [
        {
          ...judgeFinding,
          human_review_required: false,
          evidence: "a | b\nc",
          suggestion_or_flag: "use `x || y`",
        },
      ],
      headSha: "abc1234def",
      promptRevision: "local",
      models,
    });

    expect(comment).toContain("a \\| b<br>c");
    expect(comment).toContain("use &#96;x \\|\\| y&#96;");
  });

  it("escapes a trailing backslash before pipe-escaping, so it can't turn \\| into a live column break", () => {
    const comment = formatReviewComment({
      findings: [
        {
          ...judgeFinding,
          human_review_required: false,
          suggestion_or_flag: "ends in a backslash\\",
        },
      ],
      headSha: "abc1234def",
      promptRevision: "local",
      models,
    });

    // "\|" (escaped backslash + live pipe) would break out of the cell;
    // "\\\\|" (escaped backslash, still-escaped pipe) keeps the table intact.
    expect(comment).toContain("ends in a backslash\\\\");
    expect(comment).not.toMatch(/backslash\\\|/);
  });

  it("HTML-entity-encodes backticks so a finding can't close the file/line_hint code span early", () => {
    const comment = formatReviewComment({
      findings: [
        {
          ...judgeFinding,
          human_review_required: false,
          file: "src/foo.ts` | 999 | critical | injected",
        },
      ],
      headSha: "abc1234def",
      promptRevision: "local",
      models,
    });

    expect(comment).not.toContain("`src/foo.ts` | 999 | critical | injected`");
    expect(comment).toContain("&#96;");
  });
});
