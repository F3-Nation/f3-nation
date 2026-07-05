# Feature Specs

This directory holds **feature specs**: the single, unambiguous source of truth
for what a feature does, who may do it, and how we know it works. Every spec is
written **before** code generation and reviewed by a human owner. Acceptance
criteria are phrased so each one maps 1:1 to a future Playwright assertion.

Rules of the road:

- One spec per feature, at `specs/<feature-slug>.md`.
- Acceptance criteria must be **testable and non-contradictory** — each
  independently verifiable, none conflicting with another. Contradicting
  criteria are the #1 efficiency killer for AI-assisted builds; be ruthless
  about removing ambiguity.
- The RBAC section must state explicitly who **can** and who **cannot** perform
  each action — this becomes the E2E authorization matrix. Remember:
  authenticated ≠ authorized.
- The "Critical-path test cases" section is the small, must-never-break set
  that will gate deploys (the blocking E2E tier). Keep it tight.
- Humans always own sign-off on security, availability/reliability, and
  scalability. A spec is not final until its owner approves the acceptance
  criteria.

## Template

Copy everything below into `specs/<feature-slug>.md` for a new feature.

```markdown
# <Feature name>

> Status: DRAFT — acceptance criteria pending owner approval
> Owner (human accountable): <name>

## 1. Summary

One paragraph: what is this feature and who is it for? What user problem does
it solve?

## 2. Context & links

- App(s) affected: (map / api / auth / admin / me)
- Related design docs / Figma:
- Related Issues / PRs:

## 3. User stories

- As a <role>, I want <capability> so that <outcome>.

## 4. Acceptance criteria (testable, non-contradictory)

Each one must be independently verifiable and must not conflict with another.
These become the Playwright assertions.

- **AC-1** — GIVEN <state> WHEN <action> THEN <observable result>

## 5. Roles & authorization (RBAC)

Map to the oRPC procedure tiers in `packages/api/src/shared.ts` —
`publicProcedure` / `protectedProcedure` (authenticated ≠ authorized!) /
`editorProcedure` / `adminProcedure` / `nationAdminProcedure` — plus any
per-org checks (`checkHasRoleOnOrg`). State explicitly who CAN and who CANNOT
do each action.

| Action | Allowed | Explicitly denied |
| ------ | ------- | ----------------- |
|        |         |                   |

## 6. Data & migrations

- Schema changes (Drizzle):
- Migration + backfill plan:
- ⚠️ Architectural / migration risk a human must review (e.g. destructive or
  irreversible operations):

## 7. Out of scope / non-goals

-

## 8. Critical-path test cases (blocking tier)

The small, must-never-break set that gates deploy. Keep it tight.

-

## 9. Observability

- Events/metrics to emit, via `@acme/logger`:

## 10. Open questions (resolve before final)

-

## 11. Human sign-off checklist

- [ ] Acceptance criteria approved by owner
- [ ] Security reviewed (authorization, not just authentication)
- [ ] Availability / reliability reviewed (multi-instance safe)
- [ ] Scalability reviewed (query cost, no DB-melting patterns)
```
