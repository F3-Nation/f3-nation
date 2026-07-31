# CI factory (F3-61 + F3-62)

Versioned prompts and scripts for the F3 Nation CI factory: automated analysis
of preview-environment failures (F3-61 triage) and opt-in adversarial PR
review (F3-62) before any auto-heal work lands in phase 2.

## Layout

```text
prompts/
  shared.guardrails.md           Non-negotiable rules (all phases)
  triage-phase-1.system.md       Phase-1 classifier instructions
  triage-phase-1.user.template.md  Per-run user message template
  review-phase-1.reviewer-a.system.md  Spec-anchored reviewer (F3-62)
  review-phase-1.reviewer-b.system.md  Code-anchored reviewer (F3-62)
  review-phase-1.judge.system.md       Merge/dedupe/rank judge (F3-62)
  review-phase-1.*.user.template.md    Per-run user message templates
src/
  load-prompt.ts                 Read + compose prompts
  triage-e2e-failure.ts          Phase-1 triage CLI entry point
  review-pr.ts                   Phase-1 adversarial review CLI entry point
  inference.ts                   OpenAI-compatible chat completions
  review-config.ts               Per-role inference config (A / B / judge)
  format-comment.ts              Parse model JSON → triage PR comment
  format-review.ts               Parse findings JSON → review PR comment
```

Prompts are plain markdown — tool-agnostic, reviewable in PRs, and shared
across local runs and GitHub Actions.

## Phase 1: triage only

Classifies a preview E2E failure and produces a PR comment. **No code changes.**

```bash
pnpm -F @acme/ci-factory triage \
  --error-context /tmp/playwright-error.txt \
  --test-source apps/map/tests/e2e/browse.spec.ts \
  --preview-url "https://pr-42-map-....run.app" \
  --output /tmp/triage-comment.md
```

Print prompts without calling inference:

```bash
pnpm -F @acme/ci-factory triage \
  --error-context /tmp/playwright-error.txt \
  --test-source apps/map/tests/e2e/browse.spec.ts \
  --dry-run
```

### Inference environment

| Variable                         | Required                 | Notes                                       |
| -------------------------------- | ------------------------ | ------------------------------------------- |
| `CI_FACTORY_INFERENCE_API_KEY`   | yes (unless `--dry-run`) | —                                           |
| `CI_FACTORY_INFERENCE_BASE_URL`  | yes (unless `--dry-run`) | OpenAI-compatible `/v1` base; no default    |
| `CI_FACTORY_INFERENCE_MODEL`     | yes (unless `--dry-run`) | Explicit model tiering decision; no default |
| `CI_FACTORY_INFERENCE_JSON_MODE` | no                       | `1` requests `response_format: json_object` |

All three primary variables are required — the endpoint and model are explicit,
reviewable decisions, never silent defaults. JSON mode is off by default: the
response parser is the real guarantee, and some OpenAI-compatible endpoints
reject it (Anthropic's rejects `json_object` — it only accepts `json_schema`).
Anthropic (OpenAI-compatible endpoint) example:

```bash
export CI_FACTORY_INFERENCE_BASE_URL="https://api.anthropic.com/v1"
export CI_FACTORY_INFERENCE_API_KEY="..."
export CI_FACTORY_INFERENCE_MODEL="claude-haiku-4-5-20251001"
```

## Wiring into preview E2E (live)

`.github/workflows/e2e-triage.yml` runs this after a Playwright job fails in
`preview-env.yml`:

1. Collect the Playwright error output + failing spec source
2. Run `pnpm -F @acme/ci-factory triage ... --output comment.md`
3. Post one comment-only summary per fingerprint to the PR (marker:
   `<!-- ai-triage:<fingerprint> -->`), deduped and capped so a repeat failure
   never re-comments. Advisory by design: no fix PRs, label writes, or merges.

Phase 2 (auto-heal) will add separate prompts under `prompts/` — do not extend
the phase-1 prompt with fix instructions.

## Adversarial review (F3-62 phase 1)

Two independent top-tier reviewers (A: spec-anchored Anthropic, B:
code-anchored OpenAI — neither sees the other's output) plus a cheap-tier
judge that merges, dedupes against CodeRabbit, drops style nits, ranks by
severity, caps at 8 findings, and tags each `[A]`/`[B]`/`[A+B]`.
Security/availability/scalability findings are flagged for human review with
no suggested patch. Wired into `.github/workflows/adversarial-review.yml`
behind the `ai-review` PR label.

```bash
pnpm -F @acme/ci-factory review \
  --diff /tmp/pr.diff \
  --specs /tmp/specs.md \
  --coderabbit /tmp/coderabbit.txt \
  --head-sha "$(git rev-parse HEAD)" \
  --output /tmp/review-comment.md
```

`--specs` and `--coderabbit` may point at empty files. Add `--dry-run` to
print the composed prompts without calling inference.

### Review inference environment

| Variable                       | Role       | Notes                                  |
| ------------------------------ | ---------- | -------------------------------------- |
| `CI_FACTORY_REVIEW_A_API_KEY`  | reviewer A | Anthropic key (also used by the judge) |
| `CI_FACTORY_REVIEW_A_BASE_URL` | reviewer A | e.g. `https://api.anthropic.com/v1`    |
| `CI_FACTORY_REVIEW_A_MODEL`    | reviewer A | top tier, e.g. `claude-opus-4-8`       |
| `CI_FACTORY_REVIEW_B_API_KEY`  | reviewer B | OpenAI key — independent provider      |
| `CI_FACTORY_REVIEW_B_BASE_URL` | reviewer B | e.g. `https://api.openai.com/v1`       |
| `CI_FACTORY_REVIEW_B_MODEL`    | reviewer B | top tier, e.g. `gpt-5.5`               |
| `CI_FACTORY_JUDGE_MODEL`       | judge      | cheap tier, e.g. `claude-haiku-4-5-…`  |

All are required (no defaults), matching the triage config philosophy.

## Tests

```bash
pnpm -F @acme/ci-factory test
```
