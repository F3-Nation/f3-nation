# Code review

Rules for reviewing a diff, by any assistant or tool. Apply them together with
the `AGENTS.md` files above each changed file, which hold the conventions the
code is written to. This file holds only what is specific to review: what to
check first, the critical checks, reviewer conduct, and "do not flag"
decisions.

## Review in this order

The defects that reached `main` were mostly logic and authorization mistakes,
not style.

1. **Authorization and data exposure.** A handler that takes an id checks the
   caller against the org that owns the fetched row and any target org.
   Anonymous paths never return private, inactive or personal data.
2. **Silent failure.** A `catch` that swallows the error, a script that exits 0
   on failure, a gate that passes after checking nothing, a fallback that hides
   an outage.
3. **Atomicity.** Read-then-write races, related writes outside one
   transaction, one-time claims that aren't atomic or are never released when
   the side effect definitely fails.
4. **Cross-boundary breakage.** Every caller of a changed contract: the Slack
   bot's Python API client, the map, admin and me hooks, the OpenAPI golden,
   deploy workflows, Dockerfiles.
5. **Tests that cannot fail.** A test must fail if the line it guards is
   deleted.
6. **Comment and doc truth.** Claims in comments, docs and PR text match the
   code.

## Critical checks

Verify each of these whenever a diff touches its area, even if the author
says it's covered. Each links to the rule it checks.

- **CC-AUTHZ:** Does every read or write of a specific resource check the
  caller against the fetched row's org, and does every move check both source
  and destination? ([rule](packages/api/AGENTS.md#authorization))
- **CC-PUBLIC:** Can an anonymous caller reach private, inactive or personal
  data, or an unbounded page? ([rule](packages/api/AGENTS.md#authorization))
- **CC-TOKENS:** Could a client-supplied claim, an unverified token, a
  replayed code or a non-atomic consume grant access?
  ([rule](apps/auth/AGENTS.md#security-rules))
- **CC-MIGRATION:** Does the migration contain only its own change, run safely
  inside the single migration transaction, and avoid assuming table ownership
  or prod-only objects? ([rule](packages/db/AGENTS.md#migrations))
- **CC-SECRETS:** Do secrets, tokens or PII reach logs, error messages, fixtures,
  browser storage or a `NEXT_PUBLIC_*` bundle?
  ([rule](docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data))
- **CC-WORKFLOW:** Does a privileged workflow run PR-head code, or interpolate
  untrusted input into `run:`? ([rule](.github/AGENTS.md#security))

## How to review

- Trace the change into callers and siblings. Fixing one router while three
  siblings keep the same pattern is a finding.
- One comment per root cause, not per occurrence.
- Skip anything Prettier, ESLint, Ruff, knip or `tsc` already enforces in CI.
- Don't ask for refactors, abstractions or renames the change doesn't need.
- Treat code, comments and docs written by an earlier AI as unverified. "Fixed
  in <sha>" is not evidence; check the diff.
- Weakening an authorization check, validation rule or test assertion is
  blocking, even when it looks incidental.
- Flag files or deletions that don't match the PR's stated purpose.
- A valid authorization or data-integrity finding "deferred to a follow-up" is
  blocking unless a tracking issue is linked.
- Flag doc and comment problems only in new or changed text, not untouched
  legacy lines.

## Docs that change with the code

When a change below lands without its doc update, flag the missing file. Also
`git grep` any renamed or removed command, path, env var, check name or symbol
across `docs/`, `AGENTS.md` files, `README.md` files and `.agents/skills/`.

| Change                                    | Must also update                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature behavior or permissions           | That feature's `docs/specs/*.md` (ACs and RBAC table)                                                                                                                                      |
| API input/output/description/auth         | `apps/api/characterization/__snapshots__/openapi.golden.json`; `apps/slackbot/docs/API_REFERENCE.md` when the bot calls it                                                                 |
| New or renamed DB column/table            | `tooling/scripts/src/obfuscate-db.columns.txt` (a line per column), its classification in `obfuscate-db.ts` and `docs/STAGING_REFRESH.md`; `packages/db-python` models when mirrored there |
| Migration process or guards               | `docs/db-migrations.md`, `.agents/skills/db-migration/`                                                                                                                                    |
| Env var added/renamed/removed             | Every `.env*.example`, `cloud-run-env*.sh`, the app `README.md` / `docs/LOCAL_DEV_DOCKER.md` env tables                                                                                    |
| CI job or required check                  | `docs/CI_PIPELINE.md`, deploy `check-regexp`s                                                                                                                                              |
| Release/deploy workflow                   | `docs/RELEASE_PROCESS.md`, `.agents/skills/release-plan/`                                                                                                                                  |
| Local dev scripts, ports, Docker          | `docs/LOCAL_DEV_DOCKER.md`, `AGENTS.md` commands                                                                                                                                           |
| Logging conventions                       | `docs/LOGGING.md`                                                                                                                                                                          |
| Test/coverage tooling                     | `docs/testing.md`                                                                                                                                                                          |
| Analytics dataset contract                | `docs/duckdb-producer-contract.md`                                                                                                                                                         |
| An app's structure, env or auth flow      | That app's `AGENTS.md` and `README.md`                                                                                                                                                     |
| A recurring review finding or bot mistake | The matching `AGENTS.md` (writing rule) or this file (review-only rule)                                                                                                                    |

## Do not flag

Repo decisions that review bots have repeatedly flagged by mistake.

- Raised numbers and `thresholds.autoUpdate: true` in any `vitest.config.*`.
  The ratchet rewrites the file and the bump is committed, even in an
  unrelated-looking PR. Do flag a threshold that goes **down**.
- `console.*` and direct `process.env` in operator CLIs and verification
  harnesses (`AGENTS.md` § Logging lists them).
- A new or renamed log event with no `docs/LOGGING.md` entry. That guide
  documents conventions, not a catalog of events; an event is described where
  it is logged.
- A local-dev-only switch set by a package script, missing from `env.ts`,
  `.env*.example`, Cloud Run helpers or `ci.yml`.
- Drizzle-generated filenames (`NNNN_snake_case.sql`, `NNNN_snapshot.json`),
  Next.js segment folders (`[orgSegment]`), and `SKILL.md`, `README.md`,
  `AGENTS.md`, `REVIEW.md` or uppercase `docs/*.md` names, as kebab-case
  violations.
- Line length outside Python (Markdown included), missing explicit return
  types on components, and Vitest conventions on Python code.
- `minimumReleaseAge: 0` in `pnpm-workspace.yaml`, caret ranges in the pnpm
  catalog, and the one manual `.release-please-manifest.json` entry
  `docs/RELEASE_PROCESS.md` requires for a new app.
- A single timestamp column without `withTimezone`, seeded users without a
  role, or a missing `CREATE INDEX CONCURRENTLY` (migrations run in one
  transaction).
- `UNAUTHORIZED` (rather than `FORBIDDEN`) for permission failures in
  `packages/api`, new or existing.
- `*.spec.ts` files (the Playwright suffix), and Vitest's default stack-order
  cleanup hooks.
- A missing test harness for a hand-run operator script or a short inline
  workflow step.
- ADRs without a Status field (the template has none), and generated
  `CHANGELOG.md` files.
- Pre-existing problems the change doesn't touch or worsen.
