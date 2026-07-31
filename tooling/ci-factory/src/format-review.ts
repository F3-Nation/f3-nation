import { extractJsonObject } from "./format-comment";
import { sanitizeForComment } from "./sanitize";

/**
 * Parsing + rendering for the F3-62 phase-1 adversarial review chain.
 * Defensive parsing mirrors format-comment.ts: extract the JSON object from
 * possibly-fenced model output, then validate every field explicitly — the
 * parser, not JSON mode, is the schema guarantee.
 */

export type Severity = "high" | "medium" | "low";
export type FindingTag = "A" | "B" | "A+B";

export interface ReviewerFinding {
  file: string;
  line_hint: string;
  severity: Severity;
  claim: string;
  evidence: string;
  suggestion_or_flag: string;
}

export interface JudgeFinding extends ReviewerFinding {
  tag: FindingTag;
  human_review_required: boolean;
}

export const MAX_JUDGE_FINDINGS = 8;

const SEVERITIES = new Set<Severity>(["high", "medium", "low"]);
const TAGS = new Set<FindingTag>(["A", "B", "A+B"]);
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
// `A+B` (independent agreement) outranks a single-reviewer finding at equal
// severity — see judge.system.md §4.
const TAG_RANK: Record<FindingTag, number> = { "A+B": 0, A: 1, B: 1 };

function parseFindingsEnvelope(raw: string): unknown[] {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    findings?: unknown;
  };
  if (!Array.isArray(parsed.findings)) {
    throw new Error("Model output must contain a `findings` array");
  }
  return parsed.findings;
}

function parseReviewerFinding(item: unknown, index: number): ReviewerFinding {
  const finding = item as Partial<ReviewerFinding>;
  for (const field of [
    "file",
    "line_hint",
    "claim",
    "evidence",
    "suggestion_or_flag",
  ] as const) {
    if (!finding[field] || typeof finding[field] !== "string") {
      throw new Error(`findings[${index}].${field} must be a non-empty string`);
    }
  }
  if (!finding.severity || !SEVERITIES.has(finding.severity)) {
    throw new Error(
      `findings[${index}].severity is invalid: ${String(finding.severity)}`,
    );
  }
  return {
    file: finding.file!,
    line_hint: finding.line_hint!,
    severity: finding.severity,
    claim: finding.claim!,
    evidence: finding.evidence!,
    suggestion_or_flag: finding.suggestion_or_flag!,
  };
}

export function parseReviewerFindings(raw: string): ReviewerFinding[] {
  return parseFindingsEnvelope(raw).map(parseReviewerFinding);
}

export function parseJudgeFindings(raw: string): JudgeFinding[] {
  const findings = parseFindingsEnvelope(raw).map((item, index) => {
    const base = parseReviewerFinding(item, index);
    const judge = item as Partial<JudgeFinding>;
    if (!judge.tag || !TAGS.has(judge.tag)) {
      throw new Error(
        `findings[${index}].tag is invalid: ${String(judge.tag)}`,
      );
    }
    if (typeof judge.human_review_required !== "boolean") {
      throw new Error(
        `findings[${index}].human_review_required must be a boolean`,
      );
    }
    return {
      ...base,
      tag: judge.tag,
      human_review_required: judge.human_review_required,
    };
  });

  // Defensive re-application of the judge's own rules (judge.system.md §4):
  // rank by severity, then let `A+B` independent agreement break ties upward,
  // and enforce the hard cap — all hold even if the model drifts. Array.sort is
  // stable, so within an equal (severity, tag) the judge's own order survives.
  return findings
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        TAG_RANK[a.tag] - TAG_RANK[b.tag],
    )
    .slice(0, MAX_JUDGE_FINDINGS);
}

export const REVIEW_COMMENT_MARKER = "<!-- ai-adversarial-review -->";

function escapeTableCell(text: string): string {
  // sanitizeForComment neutralizes @mentions and #issue autolinks and
  // HTML-encodes angle brackets — which also defuses the `<!-- … -->` dedup
  // marker (REVIEW_COMMENT_MARKER) model-derived text could otherwise forge.
  // The remaining replacements keep the Markdown table cell intact.
  return sanitizeForComment(text)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

export function formatReviewComment(args: {
  findings: JudgeFinding[];
  headSha: string;
  promptRevision: string;
  models: { reviewerA: string; reviewerB: string; judge: string };
  truncationNote?: string;
}): string {
  const { findings, headSha, promptRevision, models, truncationNote } = args;

  const humanReviewCount = findings.filter(
    (f) => f.human_review_required,
  ).length;

  const body =
    findings.length === 0
      ? "No findings survived the merge — both reviewers came back clean (or everything was already covered by CodeRabbit)."
      : [
          "| # | Severity | Tag | File | Finding | Suggested fix / flag |",
          "| - | -------- | --- | ---- | ------- | -------------------- |",
          ...findings.map((f, i) => {
            const action = f.human_review_required
              ? `🚩 **Human review required** — ${escapeTableCell(f.suggestion_or_flag)}`
              : escapeTableCell(f.suggestion_or_flag);
            return `| ${i + 1} | ${f.severity} | \`[${f.tag}]\` | \`${escapeTableCell(f.file)}\` (${escapeTableCell(f.line_hint)}) | ${escapeTableCell(f.claim)}<br><sub>${escapeTableCell(f.evidence)}</sub> | ${action} |`;
          }),
        ].join("\n");

  const humanReviewLine =
    humanReviewCount > 0
      ? `\n**${humanReviewCount} finding(s) touch security/availability/scalability** — flagged for human review; no automated patch is suggested for those.\n`
      : "";

  return `${REVIEW_COMMENT_MARKER}
### 🤖 Adversarial review (phase 1)

Two independent reviewers (A: spec-anchored \`${models.reviewerA}\`, B: code-anchored \`${models.reviewerB}\`) reviewed this diff without seeing each other's output; a judge (\`${models.judge}\`) merged, deduped against CodeRabbit, and ranked. \`[A+B]\` = independent agreement (highest confidence).

${body}
${humanReviewLine}${truncationNote ? `\n> ${truncationNote}\n` : ""}
> Phase 1 is advisory and comment-only — findings suggest, humans decide; nothing here blocks or merges. Capped at ${MAX_JUDGE_FINDINGS} findings; style nits dropped.

_Reviewed head: \`${headSha}\` · prompt revision: \`${promptRevision}\`_
`;
}
