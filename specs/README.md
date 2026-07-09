# Feature Specs

This directory holds **feature specs**: the single, unambiguous source of truth
for what a feature does, who may do it, and how we know it works. A spec is
written **before** code generation. Acceptance criteria are phrased so each one
maps 1:1 to a future Playwright assertion.

Rules of the road:

- One spec per feature, at `specs/<feature-slug>.md`. Specs are scoped to a
  feature, not to an app or package — a feature often spans several apps, so
  the filename carries the grouping (`map-*`, `admin-*`). If the folder grows,
  group by product area, not by app.
- A spec is the source of truth once it merges to `main`, so it must describe
  behavior that is in `main` (or lands together with its code) — never a future
  or still-unmerged feature.
- Acceptance criteria must be **testable and non-contradictory** — each
  independently verifiable, none conflicting with another. Contradicting
  criteria are the #1 efficiency killer for AI-assisted builds; be ruthless
  about removing ambiguity.
- The RBAC section must state explicitly who **can** and who **cannot** perform
  each action — this becomes the E2E authorization matrix. Remember:
  authenticated ≠ authorized.
- All acceptance criteria are binding. The "Critical-path test cases" section
  only names the subset that must have end-to-end coverage first; the
  blocking-vs-advisory tier split lives in
  [`docs/E2E_TIERS.md`](../docs/E2E_TIERS.md), not here.
- Discussions involving security, availability/reliability, and scalability
  stay human-owned and are managed in the PR associated with the spec. The
  spec is a durable document.

## Template

Copy everything below into `specs/<feature-slug>.md` for a new feature, excluding triple-ticks at beginning and end of section.

```markdown
# <Feature name>

> Human designer: <f3 name> (<github tag>)

## 1. Summary

One paragraph: what is this feature and who is it for? What user problem does
it solve?

## 2. Context & links

- App(s) affected: (map / api / auth / admin / me)
- Key code:

## 3. User stories

- As a <role>, I want <capability> so that <outcome>.
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

## 6. Out of scope / non-goals

-

## 7. Critical-path test cases

The small set that must have end-to-end coverage. Keep it tight.

-

## 8. Observability

- Events/metrics emitted via `@acme/logger`:
```
