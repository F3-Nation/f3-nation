# AI Guardrails (Always / Never / Can)

> Tool-agnostic operating boundaries for AI assistants and agents working in
> this repository. [`AGENTS.md`](AGENTS.md) says **how** to work here
> (conventions, commands, style) and
> [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) says how to
> work **securely**; this file says **what AI may decide on its own, what it
> must never do, and what always belongs to a human**. If guidance conflicts,
> the stricter rule wins.

## ALWAYS DO

- **Work from a spec.** For feature work, read the feature's spec in
  [`specs/`](specs/) before generating code; if none exists, write one from
  the [template](specs/README.md) and get the acceptance criteria approved by
  a human before building.
- **Authorize, don't just authenticate.** Every new or changed endpoint uses
  the correct procedure tier **and** verifies role/ownership on the specific
  resource — `protectedProcedure` alone is not authorization (see
  [API authorization](docs/AI_DEVELOPMENT_GUIDE.md#api-authorization)).
- **Ship tests with code.** Every PR includes the tests that pin its behavior.
- **Run the CI gates locally before pushing**: `pnpm format`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm test` — a PR that fails CI wastes a
  review cycle.
- **Log through `@acme/logger`** with structured, dot-namespaced events —
  never `console.*` (see [Logging](AGENTS.md#logging)).
- **Assume multi-instance deployment.** No in-memory state as a source of
  truth (see [Reliability](docs/AI_DEVELOPMENT_GUIDE.md#reliability-in-a-multi-instance-world)).
- **Keep guardrails tool-agnostic.** Durable guidance goes in `AGENTS.md`,
  `docs/`, or this file — vendor config files stay thin pointers.
- **Flag, don't bury.** When a change touches a human-owned domain (below),
  say so explicitly in the PR description.

## NEVER DO

- **Never weaken an authorization check, validation rule, or test assertion to
  make a test pass.** If a test and an auth check disagree, stop and ask a
  human.
- **Never ship a destructive or irreversible schema migration without explicit
  human sign-off** — dropping/renaming columns or enums, casting data,
  deleting rows. Reversible-by-design is the default.
- **Never hard-delete user data** when a soft delete (`is_active = false`)
  exists for the entity.
- **Never put secrets or PII in code, logs, fixtures, seeds, or client
  bundles** (anything `NEXT_PUBLIC_*` is public — see
  [Secrets](docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data)).
- **Never use `Math.random()` for anything security-relevant.**
- **Never write queries that can melt the database at scale** (N+1 fan-outs,
  unbounded scans over large tables) — flag them for human scalability review
  instead.
- **Never merge with the blocking-tier E2E suite red** (once the suite exists;
  advisory-tier failures are triaged, not ignored).
- **Never bypass a human gate** by splitting a gated change across multiple
  small PRs.

## CAN DO (with judgment)

- Generate Playwright tests from a spec's acceptance criteria; propose
  additions to the advisory tier freely (the blocking tier changes only with
  human approval).
- Open remediation PRs for failing advisory tests, flaky tests, lint/type
  errors, and dependency housekeeping.
- Refactor **within one app or package's boundary** when tests stay green and
  the change is reviewable in one sitting.
- Add observability (log events, metrics, traces) to existing code paths.
- Draft specs, docs, and migration plans for human review.

## HUMANS ALWAYS OWN (intentional limits)

AI may draft, analyze, and flag in these domains, but a human makes the call
and signs off — no exceptions:

1. **Security** — authorization models, RBAC changes, secrets handling,
   attack surface.
2. **Availability / reliability** — multi-instance behavior, failure modes,
   anything that can take the map down.
3. **Scalability** — query cost at production scale, architectural and
   migration risk.

Plus these explicit gates regardless of domain:

- Merging to `dev`/`main` (a human merges; AI opens PRs).
- Approving a spec's acceptance criteria.
- Any change to auth/RBAC behavior.
- Deleting data or running irreversible migrations.

## See also

- [`AGENTS.md`](AGENTS.md) — repo conventions (structure, commands, style,
  commits).
- [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md) — secure
  patterns, pitfalls, and the pre-flight checklist.
- [`specs/README.md`](specs/README.md) — the feature-spec template these
  guardrails assume.
