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

## Known failure patterns

Defects of these kinds have reached `main` or nearly did, and a one-pass diff
review tends to miss them because the cause sits in another file, in library
behavior, or in an environment the diff doesn't show. Check the matching
pattern whenever a diff touches its area.

- **KP-QUERY-THROW:** The apps' query clients send query errors to the error
  boundary by default. A query whose component renders its own fallback must
  opt out (`throwOnError: false`, or a predicate that returns false for that
  error), or the fallback never shows and the page is replaced by the error
  screen.
- **KP-ABORT:** A cancelled request (navigation, unmount, a superseded query)
  raises an `AbortError`. It is not an outage: never show outage UI, retry
  banners or alerts for it. A timeout must cancel the response body read too,
  not only the wait for headers, or a stalled body hangs the page.
- **KP-SSR-TIME:** Don't compute "now" or "today" during render, including in
  `useState` initializers, in a component that renders on both the server and
  the browser. The server runs in UTC and the browser in local time, so the two
  disagree on the date for part of every day and hydration fails. A timestamp
  computed once on the server and passed unchanged to the client, such as a
  data-fetched-at prop, is fine.
- **KP-PG-OWNER:** Owner-only statements (`ALTER TABLE ... DISABLE TRIGGER`,
  `CREATE INDEX` on an existing table, `ALTER TYPE`) need the login to own the
  object, directly or through role membership. The migration runner and the
  staging refresh check ownership up front and refuse to start without it; a
  new database script that issues owner-only statements needs the same check,
  or it fails with "must be owner" partway through. Dropping or recreating a
  type or column must also handle every view that depends on it, including
  views that exist only in staging or production.
- **KP-ACTIVE:** Responses an anonymous caller can reach exclude inactive rows
  and rows under an inactive ancestor org, whatever status filter the caller
  passes. Signed-in callers keep the status filters their sibling procedures
  offer. Sibling queries in the same router are the reference; a new query
  that filters differently is a finding.
- **KP-ENV:** A new env var is read the same way as its siblings in that file
  (through the app's env schema where the app has one). A required one that is
  missing or empty fails at startup with a log line; an optional one turns its
  feature off or uses a stated default without crashing (`apps/AGENTS.md`
  covers optional settings). A local-dev-only switch set by a package script is
  exempt (see "Do not flag"). An empty allowlist that silently
  rejects everything, or a default that silently points at another
  environment, is a finding. A guard against mixing staging and production
  settings covers every variable that names the environment, including the
  `NEXT_PUBLIC_*` twin of a server variable.
- **KP-TOKENS:** Token issuer, audience and JWKS URLs match what every verifier
  (`packages/sso`, the API's session resolution) expects. A refresh grant
  reuses the scopes originally granted, not the client's full scope list. A
  proxy attaches a server-side API key only to routes that require a signed-in
  caller. A fix that stops a path from forging or inflating a credential also
  deals with the credentials that path already issued (a key rotation, a
  version marker or forced revalidation); otherwise they stay valid until they
  expire.
- **KP-FAIL-SOFT:** A helper that every request passes through, and that
  gains a network or database call, falls back to its previous behavior and
  logs when that call fails. A best-effort step (a thumbnail, a notification,
  a side call) that gains a status check or a raise must not discard the main
  result.
- **KP-BATCH:** A scheduled or batch job that loops over regions, workspaces
  or users handles each item in its own `try`, logs a failure with the item's
  id, continues with the rest, and exits non-zero if any item failed. One bad
  item must not stop the work for every item after it.
- **KP-IDENTITY:** Code that matches or creates a person from an external
  profile uses the identifier already stored for that person when the profile
  lacks the matching key (an email), and never creates a record keyed on a
  placeholder such as the external id.
- **KP-ASYNC-THROW:** An async function called without `await` (`void fn()`)
  catches throws that happen before its first `await` too. Otherwise a
  synchronous throw becomes an unhandled rejection.
- **KP-SHELL:** Scripts quote every path that comes from PR content, never
  follow a symlink from PR content when copying files, tolerate a process that
  already exited (`kill "$pid" || true` under `set -e`), exit non-zero on
  failure, and don't let an inherited `DATABASE_URL` or `DATABASE_*` point a
  local sandbox at a remote database.
- **KP-PII:** Staging obfuscation treats a row as private when it or any
  ancestor is private (a private series makes its locations private), and
  scrubs names and Slack mentions from free text and stored Slack blocks.
  Outside production, every Slack bot path that stores contact details or
  sends email or SMS goes through the same non-production handling as the
  user-creation path, so staging and local runs never keep real contact data
  or contact a real person.
- **KP-SLACK:** Slack payload values can arrive as strings (`"True"`) and
  rich-text blocks can be empty or missing. Parse leniently, keep a fallback
  for empty text, and use the channel a region saved over the default.
- **KP-UNRELATED-REVERT:** A diff that removes or rewrites lines outside the
  PR's purpose may be a stale branch undoing a fix already on `main`, often
  with the tests that guarded it. Check whether those lines were added to
  `main` recently; if they were, it is blocking.
- **KP-TOOLING:** A flag or option added to a shared script must be accepted
  by every tool it reaches through `turbo`, `pnpm -r` and wrappers such as
  `dotenv` or `pnpm exec`, in every language the workspaces use, and each
  wrapper must pass trailing arguments through. A hook or fix script that runs
  a tool in write mode and stages the result must not add files the tool
  writes when it has nothing to change.
- **KP-GUIDANCE:** A rule added to an `AGENTS.md`, skill or instruction file
  is checked against the code it names and against sibling rules; a rule that
  would break existing code if followed is a finding. A runbook's verification
  step must be able to pass at that point in the normal flow.

## How to review

- Judge behavior against the `docs/specs/` file for the feature, when one
  covers it, not against the PR description.
- Trace the change into callers and siblings. Fixing one router while three
  siblings keep the same pattern is a finding.
- For every new error path, say what the user or operator sees. For new
  logic, say which test would fail if the change were reverted, or that none
  would.
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
| Vitest setup, coverage or thresholds      | `docs/testing.md` (not a feature's own check that only runs in Vitest)                                                                                                                     |
| Analytics dataset contract                | `docs/duckdb-producer-contract.md`                                                                                                                                                         |
| An app's structure, env or auth flow      | That app's `AGENTS.md` and `README.md`                                                                                                                                                     |
| A recurring review finding or bot mistake | The matching `AGENTS.md` (writing rule) or this file (review-only rule)                                                                                                                    |

## Do not flag

Repo decisions that review bots have repeatedly flagged by mistake.

- Raised numbers and `thresholds.autoUpdate: true` in any `vitest.config.*`.
  The ratchet rewrites the file and the bump is committed, even in an
  unrelated-looking PR. Do flag a threshold that goes **down** compared with
  the base branch (not with an earlier commit in the same PR).
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
- Wording, tone, grammar, formatting or structure preferences in docs,
  Markdown and comments. Flag text only when it is wrong: a claim the code
  contradicts, a broken link, or a command, path, env var or check name that
  no longer exists.
- A missing `docs/specs/` update when no spec covers the feature. The docs
  table asks for an existing spec to be updated, not for a new one to be
  written.
- A relative link called broken before resolving it from the linking file's
  own directory. A skill at `.agents/skills/<name>/SKILL.md` reaches `docs/`
  with `../../../docs/`.
- Requests to strengthen a test assertion that already fails when the line it
  guards is deleted.
- Pre-existing problems the change doesn't touch or worsen.
