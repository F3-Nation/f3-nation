# Testing & Coverage

How unit/integration tests and coverage are set up across the monorepo. The
per-app `vitest.config.ts` files are intentionally declarative — the rationale
behind the coverage settings lives here so it stays in one place instead of
drifting across config comments.

## Running tests

- All packages: `pnpm test`
- Python task wrapper and Turbo cache regression: `bash scripts/python-task.test.sh`
  (shell assertions plus Vitest; also run by `pnpm lint`).
- A single app/package: `pnpm -C apps/map test` (append `--run` for a one-shot,
  non-watch run)
- CI runs these under the `test-coverage` check (one of the five required checks
  enforced by the `main` branch ruleset — see [AGENTS.md](../AGENTS.md)).

Use Vitest for unit and integration tests. Name test files `*.test.ts[x]` and
place them next to the source or under `__tests__`. Reset databases before any
suite that mutates data (`pnpm reset-test-db`).

## Writing tests that can fail

A test exists to fail when the behavior it pins breaks. If it would still pass
with the fix or guard line deleted, it isn't doing its job.

- Assert values, identity and persisted DB state, not `200`, `toBeDefined()` or
  `toHaveBeenCalled()`. Assert call content (SQL, params, payload).
- Assert the specific error code (`rejects.toMatchObject({ code })`), never a
  bare `rejects.toThrow()`, and after a rejection assert the DB is unchanged.
- Cover both sides of every guard: allowed and denied, source and destination
  org, wrong and missing claim, each boundary value. Authorization tests include
  a cross-org case (editor on org A, rejected on org B).
- Anonymous paths really run signed out. In `packages/api` tests the default
  session is an admin; use `mockAuthWithSession(null)`.
- Don't build the expected value from the code under test, mock the unit under
  test, or use stubs that ignore `where()` (they can't verify a filter).
- Order and tiebreak tests use fixtures whose insertion order differs from the
  expected order, across more than one page.
- Test schema-facing code against the real Drizzle schema and DB, not a mocked
  parser.

### Isolation and flakiness

- Never `if (!fixture) return`; throw or assert instead.
- DB-backed tests isolate data with unique per-test prefixes and clean up in
  `finally`, `afterEach` or `onTestFinished`, registering each fixture for
  cleanup as soon as it's created.
- Generate dates relative to now or from the DB clock, and freeze time for
  midnight and timezone cases.
- Use `vi.hoisted` for anything a `vi.mock` factory references. Restore stubs
  (`vi.unstubAllGlobals`, `vi.unstubAllEnvs`, `vi.restoreAllMocks`) in
  `afterEach`, and prefer `resetAllMocks` to `clearAllMocks` when
  implementations are set. `resetAllMocks` also clears defaults a `vi.mock`
  factory set with `mockResolvedValue` (`packages/api`'s admin session), so
  re-apply them in `beforeEach`.
- Create a fresh `Response` per mocked `fetch` call; a body can be read once.
- Wait on a deterministic signal for fire-and-forget work, never a fixed sleep,
  and leave wall-clock budgets room for a loaded CI runner.
- Env-schema tests run in the `node` environment (`// @vitest-environment node`
  in jsdom apps); under jsdom they pass vacuously.
- Use the shared `coverageInclude` / `coverageExclude` from
  `@acme/vitest-config`, not per-file allowlists.

## Coverage measurement (Vitest 4)

Vitest 4's v8 coverage provider removed the `coverage.all` option and, by
default, only measures files that a test actually imported. Left unset, an
untested file disappears from the denominator entirely, so coverage silently
answers "how much of what we imported is tested" instead of "how much of the app
is tested."

To preserve the v3 behaviour — untested files stay in the denominator — every
config sets `coverage.include` explicitly to the whole `src` tree
(`src/**/*.{ts,tsx}`). Apps that use the shared tooling import this rather than
hardcoding the glob:

```ts
import { coverageExclude, coverageInclude } from "@acme/vitest-config";
```

- **`coverageInclude`** — the whole-`src` glob (keeps untested files counted).
- **`coverageExclude`** — Vitest's built-in excludes plus non-testable
  bootstrap/config files (PostHog init, `next.config.*`, `instrumentation*`,
  Tailwind/PostCSS config, `middleware.*`). Those files would otherwise sit in
  the denominator at 0% and break thresholds on every edit.

Both constants, and the exact glob lists, are defined and documented in
[`tooling/vitest/coverage.ts`](../tooling/vitest/coverage.ts) (the
`@acme/vitest-config` package). That file is the single source of truth — update
the globs there, not in individual app configs.

## Thresholds

Coverage thresholds live in each app's `vitest.config.ts` under
`test.coverage.thresholds`. Every app that declares thresholds sets
**`autoUpdate: true`**, so Vitest ratchets the numbers up automatically as
coverage improves — guarding against regressions without manual bookkeeping.

Note that Vitest 4's AST-aware v8 remapping counts branches and functions more
granularly than v3, so whole-`src` branch/function coverage measures lower than
it did before the upgrade. The floors were lowered accordingly to sit just under
the v4 baseline while still catching regressions. The numbers in each config are
the source of truth — this doc deliberately doesn't repeat them.

### `autoUpdate` is not optional

A side effect of `autoUpdate: true` is that **`pnpm test` rewrites
`vitest.config.ts`** whenever coverage has improved. That is working as
intended: commit the updated numbers along with your tests. Do not "fix" the
dirty config by setting `autoUpdate: false` or deleting the key — that silently
converts the ratchet into a fixed floor that never rises, which is the exact
regression guard it exists to provide.

[`scripts/check-vitest-thresholds.mjs`](../scripts/check-vitest-thresholds.mjs)
enforces this. It fails any config with a `thresholds` block that lacks
`autoUpdate: true`, and runs both as a `pre-commit` job (scoped to staged
`vitest.config.*` files) and inside `pnpm lint`, which is what the `lint` CI
check executes. The pre-commit job is fast local feedback; the `lint` job is the
backstop that `--no-verify` cannot skip.

## Characterization suite (apps/api)

`apps/api/characterization/` is a behavior-pinning suite separate from the unit
tests. It pins the behavior of the code with the largest blast radius — auth
resolution and the HTTP wire layer — end to end, which unit tests don't. The
suite dispatches real `Request` objects into the real app with the auth,
codec, and CORS stack unmocked, so a change to the server layer can be proven
behavior-identical instead of argued to be. The `live` target issues real HTTP
over a socket; `hono` dispatches in-process.

The framework decision itself is recorded in
[ADR 0001](adr/0001-api-server-framework.md).

### Running it

```bash
pnpm docker:up
pnpm test:characterization
```

Run it from the repo root. `turbo.json` declares the task with
`dependsOn: [… "reset-test-db" …]`; `pnpm -C apps/api test:characterization`
skips that and reuses whatever the last suite left in the database.

CI runs it in the `test-coverage` job, sequentially after `pnpm test` — both
suites mutate the shared `f3_test` database and must never run concurrently.

### The transport seam

Every test is written against `type Invoke = (req: Request) => Promise<Response>`,
selected by `CHAR_TEST_TARGET`:

| Value            | Dispatch                                  | Used by                                    |
| ---------------- | ----------------------------------------- | ------------------------------------------ |
| `hono` (default) | the Hono app's `fetch`, in-process        | local runs and CI                          |
| `live`           | real `fetch` against `CHAR_TEST_BASE_URL` | CI's built-bundle leg and the Staging gate |

Cases needing DB fixtures or in-process module state are gated behind
`describe.runIf(target.inProcess)`, so the `live` target runs the black-box
subset without any test rewrites. Cases that only need fixtures the server can
see use `target.sharesDatabase` instead: CI's bundle leg sets
`CHAR_TEST_SHARED_DB=1` because the booted bundle and the test process share
`f3_test`, which lets it exercise `cascade-service`'s dynamic import. Staging
leaves it unset and skips those cases.

### The auth-provider live target

`auth/provider-live.char.test.ts` points at the token **producer**, a deployed
`apps/auth` (auth2 today, auth3 at the #876 cutover), rather than at apps/api.
It is configured separately from `CHAR_TEST_TARGET`, and the whole file is
skipped unless `CHAR_TEST_AUTH_ISSUER` is set, so default and CI runs skip it.
Verify each relying party's cutover against it.

| Variable                                                      | Enables                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CHAR_TEST_AUTH_ISSUER`                                       | discovery, JWKS shape and location, token-endpoint errors, forged-token reject               |
| `CHAR_TEST_AUTH_CLIENT_ID` + `CHAR_TEST_AUTH_CLIENT_SECRET`   | a `client_credentials` token (Better Auth only), verified and claim-checked                  |
| `CHAR_TEST_AUTH_USER_TOKEN` + `CHAR_TEST_AUTH_USER_CLIENT_ID` | a user access token from a real sign-in, verified and claim-checked                          |
| `CHAR_TEST_AUTH_PROVIDER_URL` (optional)                      | the relying parties' `AUTH_PROVIDER_URL` for the apps' call; defaults to the issuer's origin |

`CHAR_TEST_AUTH_ISSUER` is the issuer exactly as tokens state it in `iss`: the
origin for the hand-rolled server, `<origin>/api/auth2` for the Better Auth
instance. A user token expires after an hour, so mint it just before the run.
The file's header comment lists what it can't cover headlessly (the
email-OTP sign-in itself, among others). Claim checks read the frozen lists in
`auth/access-token-contract.ts`, which the in-process fixture test also pins.

```bash
CHAR_TEST_AUTH_ISSUER=https://auth2.example.com \
  pnpm -C apps/api test:characterization auth/provider-live
```

### Golden files are frozen

`characterization/__snapshots__/` holds one committed golden per case. **They are
frozen for Phases 0a–4 of #644.** A golden diff in #645–#650 means one of two
things: a migration bug, or a deliberate behavior change that must be called out
and signed off in that PR's description. Never regenerate goldens with `-u` to
make a red build green.

One narrow exception: `errors-validation-openapi.golden.json` and
`errors-validation-rpc.golden.json` embed Zod's own issue-message text (e.g.
`"Invalid input: expected number, received NaN"`), which is library wording,
not application behavior. A Zod version bump is the one sanctioned reason to
regenerate those two goldens outside of #645–#650, and the regeneration must
still be called out in that PR's description.

### It has no coverage thresholds, by design

The suite characterizes behavior; it does not chase a coverage number.
`apps/api`'s thresholds live in `vitest.config.ts`, which excludes this
directory. Do not add a `coverage` block to `vitest.characterization.config.ts`.

## Driving auth-bounded flows

Tests and QA flows that require sign-in go through `apps/auth`'s email-based MFA
against a local mail backend (no real inbox). See the
[Testing Guidelines in AGENTS.md](../AGENTS.md) and
[`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md) for the full recipe.
