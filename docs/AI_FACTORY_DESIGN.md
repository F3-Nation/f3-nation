# AI Factory Design — Auto-Triage/Auto-Heal (F3-61) + Adversarial Review (F3-62)

> Design for review — nothing here is built yet. Phase 1 targets the sandbox
> fork only; humans merge everything the factory produces, always.

## Shared foundation

- **Inference**: dedicated API keys (Anthropic + OpenAI) as repo secrets on
  the sandbox fork; per-provider usage alerts. Model tiering: judgment work
  on top-tier models, triage/classification on cheap tiers.
- **Guardrails are part of every prompt**: `docs/AI_GUARDRAILS.md` is
  injected verbatim. Two rules are load-bearing here: _never weaken an
  assertion, validation, or auth check to make something pass_, and
  _findings in the human-owned domains (security, availability,
  scalability) are flagged, never auto-fixed_.
- **Output is always a draft PR or a PR comment**, labeled `ai-factory`.
  The factory has no merge rights.

## F3-61 — auto-triage / auto-heal

**Trigger:** an `e2e-blocking` or `e2e-advisory` job fails on a preview run.

**Pipeline:**

1. **Collect** (plain CI, no AI): bundle the Playwright `error-context.md`
   aria snapshot, failing spec source, the PR diff, and the run URL into a
   triage artifact.
2. **Classify** (cheap model, structured output): one of
   `app-bug | test-bug | spec-mismatch | flake | infra`, with confidence
   and a one-paragraph rationale. Dedupe by error fingerprint (normalized
   failure hash) so a repeated failure never re-bills.
3. **Route:**
   - `flake` → append to the **flake ledger** issue; if it's a
     blocking-tier test, open a fix-or-demote PR proposal (the
     `E2E_TIERS.md` one-day rule, mechanized).
   - `test-bug` / `spec-mismatch` → open a **fix PR against the failing
     branch**, and when the spec is wrong, a companion spec correction.
     This session already produced three worked examples by hand (the
     AM/PM empty-state string, the muted-icon Permissions-API assumption,
     the copied-link deferral) — they become the few-shot examples and the
     eval set.
   - `app-bug` → analysis comment on the PR; a fix PR only at high
     confidence and never in auth/RBAC paths.
   - `infra` → comment + ping (no automation).
4. **Report**: every action links the classification rationale.

**Controls:** daily run cap; fingerprint dedupe; precision metric tracked
weekly (% of factory PRs merged without rework) — if precision drops, the
factory demotes itself to comment-only.

## F3-62 — adversarial review

**Trigger:** PR labeled `ai-review` (opt-in in phase 1; all sandbox PRs in
phase 2). Complements CodeRabbit, which stays for code smells.

**Pipeline:**

1. **Reviewer A (Anthropic, top tier, spec-anchored):** loads the relevant
   `specs/*.md`, `AI_GUARDRAILS.md`, and the diff. Hunts violations of
   acceptance criteria, the Never-Do list, and RBAC expectations from the
   spec's authorization table.
2. **Reviewer B (OpenAI, top tier, code-anchored):** sees only the diff +
   surrounding code. Hunts logic bugs, injection/validation gaps, perf
   footguns (N+1, unbounded queries).
3. **Judge (cheap tier):** merges A+B findings, drops duplicates —
   including anything CodeRabbit already commented — ranks by severity,
   discards style nits, caps at N findings.
4. **Output:** one PR review with inline comments, each tagged `[A]`,
   `[B]`, or `[A+B]` (independent agreement = highest confidence).
   Findings touching security/availability/scalability get a
   `human-review-required` tag instead of a suggested patch.

**Why two independent models:** different vantage points (spec-down vs
code-up) and different failure modes; agreement is signal, and neither sees
the other's output until the judge stage — that's the "adversarial" part.

**Cost envelope:** roughly 2–6 top-tier calls per reviewed PR; estimated
well under a dollar per typical PR, capped by the label opt-in in phase 1.

## Rollout

1. **Phase 1 (sandbox):** F3-62 behind the `ai-review` label; F3-61
   collector + classification comment only (no auto-PRs yet).
2. **Phase 2 (sandbox):** F3-61 fix-PRs for `test-bug`/`flake` classes;
   F3-62 on all non-draft sandbox PRs.
3. **Phase 3:** port with the roll-up; F3 org owns keys/budget decisions.

## Human gates

All merges; any suggestion touching auth/RBAC; provider spend alerts; the
weekly precision review. The factory's job is to shrink human review to
judgment calls — not to remove it.
