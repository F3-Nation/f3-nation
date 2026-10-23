---
applyTo: "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/__tests__/**,**/tests/**,apps/api/characterization/**,**/vitest.config.*,**/vitest.*.ts,tooling/vitest/**"
---

# Tests and coverage config

Background: `docs/testing.md`. Tests exist to pin behavior, not to reach a
number.

## A test must be able to fail

- Ask whether the test still passes with the fix or guard line deleted. If it
  does, that is a finding.
- Assert values, identity and persisted DB state, not `200`,
  `toBeDefined()` or `toHaveBeenCalled()`. Assert call content (SQL, params,
  payload).
- Assert the specific error code (`rejects.toMatchObject({ code })`), never a
  bare `rejects.toThrow()`. After a rejection, assert the DB is unchanged.
- Cover both sides of every guard:
  - Allowed **and** denied.
  - Source **and** destination org.
  - Wrong **and** missing claim.
  - Each boundary value.
- Authorization tests include a cross-org case (editor on org A, rejected on
  org B).
- Anonymous paths must really run signed out (`mockAuthWithSession(null)`).
  The default client is an admin, and dev mode returns a mock session.
- Don't build the expected value from the code under test. Don't mock the
  unit under test. Stubs that ignore `where()` can't verify a filter.
- Order and tiebreak tests need fixtures whose insertion order differs from
  the expected order, across more than one page.
- Assert literal timeouts and limits when they are the point of the change.
- For schema-facing code, test against the real Drizzle schema and DB, not
  a memory adapter or a mocked parser. Framework wiring (Next `proxy.ts`
  discovery, route handlers) needs a test that goes through the framework,
  not one that imports the function directly.

## Isolation and flakiness

- Never `if (!fixture) return`; throw or assert instead.
- DB-backed tests isolate data with unique per-test prefixes and clean up in
  `finally`, `afterEach` or `onTestFinished`. Register each fixture for
  cleanup as soon as it's created. Don't ask for a DB reset per suite; the
  global setup already resets.
- Generate dates relative to now, or from the DB clock. Never hard-code
  future dates. Freeze time for midnight and timezone cases.
- Use `vi.hoisted` for anything referenced in a `vi.mock` factory.
  - Restore stubs (`vi.unstubAllGlobals`, `vi.unstubAllEnvs`,
    `vi.restoreAllMocks`) in `afterEach`, not on the last line of a test.
  - Prefer `resetAllMocks` to `clearAllMocks` when implementations are set.
- Create a fresh `Response` per mocked `fetch` call; a body can be read only
  once.
- Wait on a deterministic signal for fire-and-forget work, never a fixed
  sleep. Wall-clock budgets must survive a loaded CI runner.
- Env-schema tests run in the `node` environment. Under jsdom they pass
  vacuously.
- Vitest runs cleanup hooks in stack order. Do not flag that as an ordering
  bug.

## Coverage config (`vitest.config.*`)

- Keep `thresholds.autoUpdate: true`. Rewritten, higher numbers are expected
  and must be committed. **Do not flag them.**
- Flag any threshold that decreases, including through a merge-conflict
  resolution (keep the higher value per metric), plus any `autoUpdate: false`
  or a deleted key.
- When coverage drops, add tests for real untested behavior. Never write
  filler tests or hand-lower a threshold. Apps may use the buffered ratchet.
- Use the shared `coverageInclude` / `coverageExclude` from
  `@acme/vitest-config`, not per-file allowlists.
- `*.spec.ts` is the Playwright suffix. Do not ask to rename it.
