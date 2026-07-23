# Testing & Coverage

How unit/integration tests and coverage are set up across the monorepo. The
per-app `vitest.config.ts` files are intentionally declarative — the rationale
behind the coverage settings lives here so it stays in one place instead of
drifting across config comments.

## Running tests

- All packages: `pnpm test`
- A single app/package: `pnpm -C apps/map test` (append `--run` for a one-shot,
  non-watch run)
- CI runs these under the `test-coverage` check (one of the five required checks
  enforced by the `main` branch ruleset — see [AGENTS.md](../AGENTS.md)).

Use Vitest for unit and integration tests. Name test files `*.test.ts[x]` and
place them next to the source or under `__tests__`. Reset databases before any
suite that mutates data (`pnpm reset-test-db`).

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
  bootstrap/config files (Sentry init, `next.config.*`, `instrumentation*`,
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

## Driving auth-bounded flows

Tests and QA flows that require sign-in go through `apps/auth`'s email-based MFA
against a local mail backend (no real inbox). See the
[Testing Guidelines in AGENTS.md](../AGENTS.md) and
[`docs/QA_LOCAL_AUTH.md`](QA_LOCAL_AUTH.md).
