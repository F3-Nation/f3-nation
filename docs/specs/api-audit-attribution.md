# API audit user attribution

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

Record the authenticated person responsible for changes made through the event,
organization, location, user, attendance and map-request API write paths. The
database's existing audit triggers store that identity alongside the changed
rows. Attribution stays within the transaction that performs the writes, so a
reused database connection cannot carry one person's identity into another
request.

Only the write block uses the transaction-backed context. Post-commit and
detached work runs after that block completes and receives the original,
non-transactional database client.

## 2. Context & links

- App(s) affected: API and its database-writing consumers; no new UI.
- Audit storage and access contract: [database audit history](database-audit-history.md).
- Database transaction helper: [audit.ts](../../packages/db/src/audit.ts).
- API identity adapter: [with-audit-context.ts](../../packages/api/src/lib/with-audit-context.ts).
- Existing authorization tiers: [shared.ts](../../packages/api/src/shared.ts).

## 3. User stories

- As an authorized history reader, I can identify the person who made an API
  change without mistaking the edited person or an API-key owner for the actor.
- As a maintainer, I can rely on attribution being committed or rolled back
  with the source writes, including related rows and nested write transactions.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN an authorized human session WHEN a covered API write commits
  THEN its source changes and their history rows persist, with `changed_by`
  equal to the authenticated actor's integer `users.id`.
- **AC-2** — GIVEN a mutation affecting another user or organization WHEN it is
  authorized THEN attribution uses the session actor, not an input user ID,
  email, request submitter, API client header or target record owner.
- **AC-3** — GIVEN an API-key session, anonymous request, local mock identity or
  session without a positive integer user ID WHEN an otherwise permitted write
  succeeds THEN `changed_by` is NULL. Attribution grants no permission.
- **AC-4** — GIVEN covered writes and related history WHEN their transaction
  fails THEN neither the source changes nor their history persist. Existing
  error codes and resource authorization remain unchanged.
- **AC-5** — GIVEN an attributed transaction that commits or rolls back WHEN
  its connection is reused by another request or unattributed write THEN no
  previous actor identity leaks into that write. Concurrent requests also keep
  their identities separate.
- **AC-6** — GIVEN a covered mutation that performs multiple related writes
  WHEN it succeeds THEN the same actor applies to those writes, including writes
  performed through a nested transaction or a helper receiving the transaction.
- **AC-7** — GIVEN a covered mutation with email, webhook or cache effects WHEN
  its writes fail THEN those effects do not run; after a successful commit,
  existing effect behavior and failure handling remain intact. A success
  response implies the source writes committed; a later best-effort notification
  failure cannot undo those writes.
- **AC-8** — GIVEN a query, including a read-only endpoint transported as POST,
  WHEN it runs THEN attribution adds no transaction or writes to it.
- **AC-9** — GIVEN a pending map request WHEN it is submitted THEN its request
  record uses the submitter's authenticated identity, if present. When a human
  later approves or rejects it, that decision's writes use the decision maker's
  identity. An API-key decision has NULL attribution.
- **AC-10** — GIVEN an attributed API write WHEN history is recorded THEN
  `changed_via` remains NULL. The database helper accepts an optional source for
  callers that explicitly supply one. Each call sets both attribution settings
  transaction-locally in one SQL statement, using empty values when absent,
  rather than inheriting connection state.

Covered write paths are the mutations in the `event`, `org`, `location`, `user`,
`attendance` and `request` routers. Read-only procedures in those routers are
excluded. An API request cannot supply the attribution settings directly.

## 5. Roles & authorization (RBAC)

Existing procedure tiers and resource checks decide whether a write is allowed.
Attribution neither adds roles nor substitutes an identity for authorization.
API keys retain their existing scoped permissions, but their owners are not
identified as the people who performed automated writes.

Covered mutations declare their response schemas. Attendance responses retain
their existing fields. Successful user deletion returns `{ userId }`, matching
the identifier response used by the other CRUD delete endpoints.

| Action                        | Allowed                                                    | Explicitly denied                                                         |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Perform a covered write       | Callers passing its existing procedure and resource checks | Callers rejected by those checks                                          |
| Supply a human audit identity | Server-derived authenticated user identity                 | Request-body or client-header identity claims; API-key owner substitution |
| Read history                  | Existing authorized database readers                       | Callers without the existing database grants                              |

## 6. Out of scope / non-goals

- Python writes, other routers, service-principal identities and historical
  attribution backfill.
- Application-source detection, new history tables, migrations, grants or a
  history API/UI.
- Post-commit system bookkeeping, such as notification claim/release metadata;
  these independent writes retain NULL attribution.
- Changes to authorization, request inputs, transaction-pool settings or
  notification delivery policy.

## 7. Critical-path test cases

Use the API's real migrated, isolated test database and synthetic users:

1. Exercise each covered write path and inspect stored history, including
   updates to another user's data and related join rows.
2. Verify human, API-key, anonymous and local mock identity handling, with
   existing unauthorized and cross-organization cases retained.
3. Force a failure after a write and verify source/history rollback and no
   post-commit effect. Verify success effects observe committed source data,
   detached bookkeeping retains NULL attribution, and notification failure does
   not erase a committed pending request.
4. Reuse one database connection after commit and rollback; interleave two
   attributed transactions and check the persisted actor on every result.
5. Exercise pending submission, human approval/rejection and API-key
   approval without trusting the request's submitter as the decision maker.
6. Retain query results, attendance response fields and existing soft-delete
   behavior; verify the user-deletion identifier response.
7. Verify an unconverted router still records NULL attribution.
8. Drive a covered write through the local app and inspect its source row and
   history together. Use a synthetic authenticated user and the existing
   application flow, with no new public history endpoint.

Stored-history assertions use SQL/Vitest in the existing serial API test suite;
the application flow supplies end-to-end evidence. Attribution must remain
isolated when a transaction pooler reuses backend connections.

## 8. Observability

The history row is the attribution record. Existing structured logs and
notification diagnostics remain in place; do not log session contents, SQL
parameters, secrets or personal data to report attribution.
