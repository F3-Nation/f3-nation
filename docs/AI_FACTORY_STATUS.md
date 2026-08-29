# AI Factory — Status

> Tracks what parts of the AI factory design (F3-61 auto-triage, F3-62
> adversarial review — see `AI_FACTORY_DESIGN.md` on the design branch) are
> actually live on this sandbox fork.

## Phase 1 status

**Live (comment-only triage, F3-61 phase 1):**

- `.github/workflows/e2e-triage.yml` runs after every "Preview Environment"
  run, inspects job conclusions for failed `e2e*` jobs, collects the
  Playwright `error-context.md` snapshots + failing spec source, classifies
  the failure via `claude-haiku-4-5` into
  `{app-bug, test-bug, spec-mismatch, flake, infra}`, and posts one PR
  comment per error fingerprint (marker `<!-- ai-triage:<fp> -->`).
- Controls in place: fingerprint dedupe (a repeated failure never re-bills or
  re-comments), a hard cap of 5 triage comments per PR, a 10-minute job
  timeout, and guardrail essentials embedded in the classifier prompt (never
  weaken assertions/auth; security/availability/scalability findings are
  flag-only).
- Single secret: `F3_AI_SDLC_CLAUDE_API_KEY` (Anthropic). The workflow has no
  write access beyond PR comments.

**Live (adversarial review, F3-62 phase 1 — behind the `ai-review` label):**

- `.github/workflows/adversarial-review.yml` runs on `pull_request_target`
  `[labeled, synchronize]` for same-repo PRs carrying the `ai-review` label
  (opt-in in phase 1). It collects the `origin/main...HEAD` diff (capped at
  ~120KB with a truncation note), all `specs/*.md` when the diff touches
  `apps/map`/`apps/admin`/`packages/api`, and existing CodeRabbit review
  comments, then runs `pnpm -F @acme/ci-factory review`:
  - **Reviewer A** — spec-anchored, Anthropic `claude-opus-4-8`
    (`CI_FACTORY_REVIEW_A_*`): acceptance-criteria violations, Never-Do
    violations, RBAC-table contradictions.
  - **Reviewer B** — code-anchored, OpenAI `gpt-5.5` (`CI_FACTORY_REVIEW_B_*`;
    model is workflow config, bump as flagships move): logic bugs,
    injection/validation gaps, perf footguns. Neither reviewer sees the
    other's output.
  - **Judge** — cheap tier `claude-haiku-4-5` on the Anthropic credentials
    (`CI_FACTORY_JUDGE_MODEL`): merges, dedupes (including against
    CodeRabbit), drops style nits, ranks by severity, caps at 8, tags each
    finding `[A]`/`[B]`/`[A+B]`. Security/availability/scalability findings
    get `human_review_required` and **no suggested patch**.
- Output is ONE PR comment (marker `<!-- ai-adversarial-review -->`),
  upserted in place on synchronize; the body carries the reviewed head SHA,
  and an already-reviewed SHA is skipped (never re-bills, never re-comments).
- Controls: 15-minute job timeout, shared guardrails composed into all three
  prompts, advisory/comment-only (no labels, no checks, no merges).
- Secrets: `F3_AI_SDLC_CLAUDE_API_KEY` (reviewer A + judge) and
  `F3_AI_SDLC_OPENAI_API_KEY` (reviewer B).

**Not live yet:**

- Fix PRs for `test-bug`/`flake` classifications (phase 2 of F3-61) — the
  factory currently comments only; it opens no branches or PRs.
- The flake ledger and the fix-or-demote automation.
- F3-62 phase 2: review on all non-draft sandbox PRs (currently label-only),
  and inline per-line review comments (currently one summary comment with a
  findings table).
- A `specs/` directory — reviewer A runs spec-less until specs land at the
  reviewed commit.
- Precision tracking / weekly review metrics.
