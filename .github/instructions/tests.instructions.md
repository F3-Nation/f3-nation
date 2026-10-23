---
applyTo: "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/__tests__/**,**/tests/**,apps/api/characterization/**,**/vitest.config.*,**/vitest.*.ts,tooling/vitest/**"
---

# Tests and coverage config

Background: `docs/testing.md`. Tests pin behavior; they don't exist to reach a
number.

## A test must be able to fail

- Would it still pass with the fix or guard line deleted? If so, that is a
  finding.
- Assert values, identity and persisted DB state, not `200`, `toBeDefined()`
  or `toHaveBeenCalled()`. Assert call content (SQL, params, payload).
- Assert the specific error code (`rejects.toMatchObject({ code })`), never a
  bare `rejects.toThrow()`. After a rejection, assert the DB is unchanged.
- Cover both sides of every guard: allowed and denied, source and destination
  org, wrong and missing claim, each boundary value. Authorization tests
  include a cross-org case (editor on org A, rejected on org B).
- Anonymous paths must really run signed out. In `packages/api` tests the
  default session is an admin; use `mockAuthWithSession(null)`. In dev mode
  (not under test), credential-less requests get a role-less mock session,
  not `null`.
- Don't build the expected value from the code under test, mock the unit under
  test, or use stubs that ignore `where()` (they can't verify a filter).
- Order and tiebreak tests need fixtures whose insertion order differs from
  the expected order, across more than one page.
- Schema-facing code is tested against the real Drizzle schema and DB, not a
  mocked parser.

## Isolation and flakiness

- Never `if (!fixture) return`; throw or assert instead.
- DB-backed tests isolate data with unique per-test prefixes and clean up in
  `finally`, `afterEach` or `onTestFinished`, registering each fixture for
  cleanup as soon as it's created. Only `packages/api`'s Vitest global setup
  resets the DB; other suites rely on `pnpm reset-test-db`, so don't ask for
  a per-suite reset in `packages/api`.
- Generate dates relative to now, or from the DB clock. Never hard-code future
  dates. Freeze time for midnight and timezone cases.
- Use `vi.hoisted` for anything referenced in a `vi.mock` factory.
  - Restore stubs (`vi.unstubAllGlobals`, `vi.unstubAllEnvs`,
    `vi.restoreAllMocks`) in `afterEach`, not on a test's last line.
  - Prefer `resetAllMocks` to `clearAllMocks` when implementations are set.
- Create a fresh `Response` per mocked `fetch` call; a body can be read once.
- Wait on a deterministic signal for fire-and-forget work, never a fixed
  sleep. Wall-clock budgets must survive a loaded CI runner.
- Env-schema tests run in the `node` environment (`// @vitest-environment
node` in jsdom apps); under jsdom they pass vacuously.
- Vitest runs cleanup hooks in stack (reverse) order by default. Don't flag
  that as an ordering bug.

## Coverage config (`vitest.config.*`)

- `thresholds.autoUpdate: true` rewrites thresholds upward; the bump must be
  committed. **Do not flag it.**
- Flag any threshold that decreases, including through a merge-conflict
  resolution (keep the higher value per metric). When coverage drops, add
  tests for real untested behavior; no filler tests, no hand-lowering.
- Use the shared `coverageInclude` / `coverageExclude` from
  `@acme/vitest-config`, not per-file allowlists.
- `*.spec.ts` is the Playwright suffix. Do not ask to rename it.
