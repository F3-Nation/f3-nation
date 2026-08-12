# E2E Test Tiers

The E2E suites (Playwright, run against per-PR preview environments — see
`.github/workflows/preview-env.yml`) are split into two tiers with different
contracts. The split exists to answer the classic flaky-E2E objection: the
gate stays trustworthy because it stays tiny.

## The two tiers

| Tier         | Directory                        | Script              | CI job         | On failure                          |
| ------------ | -------------------------------- | ------------------- | -------------- | ----------------------------------- |
| **Blocking** | `apps/<app>/tests/e2e/`          | `test:e2e`          | `e2e-blocking` | **No merge.** Red means stop.       |
| **Advisory** | `apps/<app>/tests/e2e-advisory/` | `test:e2e:advisory` | `e2e-advisory` | Run stays green; failure is triaged |

Each tier is a Playwright _project_ (`blocking` / `advisory`) defined in the
shared config (`tooling/playwright/base.ts`); the directory a spec lives in
decides its tier. The advisory CI job sets `continue-on-error: true` at the
job level and uploads its own failure artifacts
(`playwright-advisory-artifacts-pr-<n>`), distinct from the blocking job's.

## What qualifies for the blocking tier

A test belongs in `tests/e2e/` only if **all** of these hold:

- **Critical path** — it covers a critical-path acceptance criterion from a
  feature spec (`specs/`), i.e. a flow whose breakage means the app is not
  shippable (map loads anonymously, search works, detail panel opens…).
- **Deterministic** — it depends only on the seeded preview data and stable
  selectors; no timing luck, no third-party variance, no "usually passes".
- **Small** — the whole blocking suite stays minutes-not-hours and small
  enough that every developer trusts a red result. When in doubt, it goes to
  advisory.

Everything else — secondary ACs, keyboard/a11y niceties, permission edge
cases, exploratory coverage — lives in `tests/e2e-advisory/`.

## Promotion and demotion

- **Flaky blocking test → fix or demote within a day.** A blocking test that
  fails intermittently is an incident for the gate itself: either make it
  deterministic immediately or move it to `tests/e2e-advisory/` while it is
  investigated. **Never** paper over it with retry loops, re-runs, or
  "known flaky, re-kick CI" habits — that is how gates die.
- **Promote deliberately.** An advisory test can move to blocking once it
  covers a critical path, has run clean long enough to be trusted (as a rule
  of thumb: no unexplained failures across recent PR runs), and keeps the
  blocking suite small.
- Tier moves are just `git mv` between the two directories — call them out
  in the PR description so the gate change is reviewed as such.

## Advisory failures are triage input, not noise

An advisory failure never blocks a merge, but it is never ignored either:
each one is a signal to triage — a real regression on a secondary path, a
selector drift, or a test that should be fixed or deleted. **F3-61** auto-triage
(`.github/workflows/e2e-triage.yml`) now runs on every preview: it consumes the
advisory (and blocking) results, classifies each failure with a cheap model,
and posts one comment-only summary per fingerprint on the PR — it never blocks a
merge and never files issues. Manual triage (check the `e2e-advisory` job and
its artifacts) remains the fallback for anything the automation can't handle. Do
not let a permanently-red advisory test sit — a test nobody reacts to is worse
than no test.
