# Request-scoped database audit attribution

> Human designer: Crash (@BigGillyStyle)

## 1. Summary

Database history identifies the person responsible for a write made during an
authenticated API request. Shared request middleware and the database client
propagate identity to the existing history triggers, so individual handlers
need no audit calls. Existing authorization and API responses remain unchanged.

## 2. Context & links

- Apps affected: API procedures, including consumers that invoke the router
  in process.
- Key code: [audit context and client hook](../../packages/db/src/utils/audit-context.ts),
  [database client creation](../../packages/db/src/utils/functions.ts), and
  [procedure middleware](../../packages/api/src/shared.ts).
- History capture and field parsing: [database audit-history foundation](database-audit-history.md).

## 3. User stories

- As an authorized history reader, I can identify the signed-in person who
  changed a tracked row.
- As an API maintainer, I can add an authorized write without adding
  per-handler attribution code.
- As a caller, I retain transaction results, rollback behavior and transaction
  options when attribution is active.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an authenticated personal session WHEN a real API procedure
  writes a tracked row THEN history records that session's positive integer
  user id, including when the session represents the id as a numeric string.
- **AC-2** — GIVEN an API-key, anonymous, development-mock or invalid-identity
  request WHEN it writes a tracked row THEN history records NULL actor and
  NULL source. Accepted API actors are integers in `1..2147483647`; zero,
  negative, fractional, nonfinite and out-of-range values are not actors.
- **AC-3** — GIVEN active context WHEN Drizzle performs an insert, update,
  delete or raw `execute` write THEN history records the actor and the write's
  returned rows and values remain unchanged.
- **AC-4** — GIVEN active context WHEN an explicit transaction or nested
  savepoint writes THEN its history inherits the transaction's attribution.
- **AC-5** — GIVEN active context WHEN a transaction requests serializable
  isolation and deferrability THEN both options take effect and its committed
  write records the actor.
- **AC-6** — GIVEN an attributed transaction WHEN it rolls back THEN neither
  its source changes nor its history changes persist.
- **AC-7** — GIVEN a connection reused after attributed commit or rollback
  WHEN a later write has no active context THEN its attribution is NULL.
- **AC-8** — GIVEN concurrent writes by many actors through a small pool
  WHEN every write completes THEN every expected history row has the exact
  actor/source for its write, using NULL-safe comparisons and exact row counts.
- **AC-9** — GIVEN a read in request context WHEN it executes outside an
  explicit transaction THEN the hook sends no BEGIN or attribution statement.
- **AC-10** — GIVEN no context or a context with both fields NULL WHEN a
  query or transaction executes THEN the original client functions receive it
  without added statements or a new transaction.
- **AC-11** — GIVEN an active context WHEN settings SQL is built THEN it
  accepts only a positive integer actor within the database integer range or
  NULL, and a source containing only lowercase ASCII letters, digits and
  hyphens or NULL. Any other value throws before a statement, including BEGIN,
  is sent. NULL becomes an empty setting value.
- **AC-12** — GIVEN active context WHEN attribution is initialized THEN one
  `unsafe()` call sends both validated `SET LOCAL` statements without bind
  parameters. No session-level setting or attribution SELECT is used.
- **AC-13** — GIVEN a lazy write query WHEN it is constructed or values mode
  is selected THEN it has not executed. Repeated consumption executes it once
  and resolves only after its transaction completes.
- **AC-14** — GIVEN native transaction options or an immediate array returned
  by a transaction callback WHEN the hook executes it THEN native option and
  result behavior is preserved.
- **AC-15** — GIVEN the installed Drizzle adapter WHEN statement and
  transaction paths run THEN regression coverage detects changes to the
  `unsafe`, `begin` and savepoint boundaries the hook relies on.
- **AC-16** — GIVEN work created within a request WHEN its asynchronous write
  executes after the procedure returns THEN it retains that request's actor.
  A new write through the shared client in `auditContext.exit(...)` has no
  inherited actor.
- **AC-17** — GIVEN the full change WHEN existing router and transport
  characterization suites run THEN they pass without handler, router or
  response-contract changes.
- **AC-18** — GIVEN the approved Staging environment WHEN a signed-in user
  edits a tracked entity through the UI THEN its history records that user.

## 5. Roles & authorization (RBAC)

Existing procedure tiers and resource checks authorize source writes. Audit
context supplies informational attribution; it grants no permission and does
not make a supplied user id proof of authentication. History access continues
to follow the database audit-history foundation's grants.

| Action                            | Allowed                                                          | Explicitly denied                                                               |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Change a source row               | Callers authorized by the existing procedure and resource checks | Callers rejected by those checks                                                |
| Attribute a personal API write    | Resolved personal sessions with a positive integer actor         | API-key ownership, anonymous and development-mock identities as personal actors |
| Read history                      | Roles with existing explicit history grants                      | Roles without the required history grants                                       |
| Establish context outside the API | Trusted server code using the helper and a hooked client         | Client input as an independent authority to choose an actor                     |

## 6. Out of scope / non-goals

- Database migrations, trigger changes, history backfill, new history endpoints
  or UI, and changes to authorization or response contracts.
- Selecting an originating application: API middleware supplies NULL source.
- Automatic attribution for Python, scripts, manual SQL, or independently
  constructed clients. A non-oRPC caller must establish context and use a
  hooked client; exporting the helper does not modify other clients.
- Complete SQL parsing. The detector recognizes the declared leading write
  forms and data-modifying CTEs. Hidden writes through functions invoked by a
  SELECT, and other SQL forms the pattern misses, remain unattributed.

## 7. Critical-path test cases

Use SQL/Vitest assertions against disposable local databases for attribution
and transaction behavior. These directly observe history and native query
boundaries without adding a history UI or test endpoint.

- Real client writes and RETURNING, raw execute, explicit transactions,
  savepoints, serializable/deferrable options and rollback.
- Exact actor/source isolation under concurrent load and subsequent pooled
  connection reuse, including NULL attribution after commit and rollback.
- Observed read statements, lazy once-only execution, native callback results,
  and invalid settings rejected before any statement.
- Real procedure middleware identity cases, an existing production-router
  mutation, overlapping contexts and detached work.
- Approved Staging UI verification for the application acceptance criterion.

Database-package integration tests use a separate disposable test database so
another package's global reset cannot destroy their fixtures. Existing API
tests retain their normal reset lifecycle. No test targets a shared database.

## 8. Observability

Existing database and API failure paths handle rejected writes; the hook adds
no logging of context, SQL parameters, source rows or history snapshots.
Attribution SQL validation errors do not echo rejected input.

The hook depends on Drizzle's postgres-js execution boundaries: statements
reach `unsafe`, top-level transactions reach `begin`, and nested transactions
use savepoints. Its regression tests enforce that dependency. It is installed
after the query-timeout wrapper so ordinary reads retain their existing
behavior. Attributed standalone writes run inside native transactions and use
the database role's `statement_timeout`, as explicit transactions do; BEGIN
must not be wrapped in a client-side timeout.

Lazy Drizzle builders must be consumed within `runWithAuditContext`'s callback.
Constructing a builder there and awaiting it after the callback has returned
loses context. Background work inherits context when its asynchronous resource
is created; use `auditContext.exit(...)` when that attribution is inappropriate.
An already-open transaction keeps the attribution set at its entry, including
through savepoints; changing ambient context does not retag that transaction.
