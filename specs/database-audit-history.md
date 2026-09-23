# Database audit-history foundation

> Approved design; implementation accompanies this spec.
> Human designer: Tackle (@taterhead247)
> Prepared September 22, 2026. Reviewed by Tackle on September 22, 2026.

## 1. Summary

Record row-level changes to an explicit set of 26 public-schema tables so
maintainers can inspect previous and new values and the transaction time of
changes. Database triggers capture API, Python and direct SQL writes alike.
Each source table has a same-named history table in its sister history schema.
Bookkeeping-only changes can be ignored; sensitive values are masked.

## 2. Context & links

- App(s) affected: API and its database-writing consumers; no new UI.
- Key code: `packages/db/drizzle/schema.ts`, `packages/db/src/migrate.ts`,
  `packages/db/src/utils/reset-test-db.ts`, `packages/api/src/router/request.ts`.
- Required template: `specs/README.md`; test tiers: `docs/E2E_TIERS.md`;
  human-owned decisions: `docs/AI_GUARDRAILS.md`.

- Issue: https://github.com/F3-Nation/f3-nation/issues/664
- Confirmed decisions:
  https://github.com/F3-Nation/f3-nation/issues/664#issuecomment-5778947816
- @taterhead247 approved the 26-table list, sister schemas and redaction markers.
- An audit-write failure fails the source write; @taterhead247 requests team
  feedback on this policy when code is available.
- The existing read-only PostgreSQL role should receive history read access.
  Exact role identity and deployment runner/owner must be verified before release.
- Attribution integration remains #665 (user) and #667 (originating app).
- Reference implementation only: PR #825 at commit 890bb587,
  packages/db/drizzle/0029_audit_history.sql. That PR remains unchanged.
- Main implementation lives in packages/db custom migrations. SQL integration
  and real-router tests share packages/api's serial database test lifecycle.

## 3. User stories

- As an authorized database reader, I can see previous and new row values and
  when changes occurred without needing the originating app to record them.
- As a maintainer, I can exclude bookkeeping noise and inspect secret rotations
  without retaining secret values.
- As a migration operator, I can enable or disable tracking for an approved
  table without deleting already collected history.

## 4. Acceptance criteria (testable, non-contradictory)

Tackle approved these criteria in [the review comment](https://github.com/F3-Nation/f3-nation/issues/664#issuecomment-5781915074).
The implementation choices and source inventory below complete the planning details.

### Scope and data contract

Only these public tables are enabled:

| Group                | Tables                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People/access (7)    | users, roles, permissions, api_keys, roles_x_users_x_org, roles_x_permissions, roles_x_api_keys_x_org                                                               |
| Organizations (4)    | orgs, positions, positions_x_orgs_x_users, orgs_x_slack_spaces                                                                                                      |
| Locations/events (9) | locations, events, event_instances, event_types, event_tags, events_x_event_types, event_tags_x_events, event_instances_x_event_types, event_tags_x_event_instances |
| Attendance (3)       | attendance, attendance_types, attendance_x_attendance_types                                                                                                         |
| Achievements (2)     | achievements, achievements_x_users                                                                                                                                  |
| Requests (1)         | update_requests                                                                                                                                                     |

No automatic inclusion of new tables. All other tables are excluded, including
Codex, auth, slack_spaces, slack_users, expansions, expansions_x_users and
alembic_version. Missing primary keys are a preflight failure, not permission
to broaden the work into schema/data repair.

`audit` holds helpers. `public_history.<table>` holds each table's history.
The helper uses the general naming rule `<source_schema>_history.<table>`;
that capability does not authorize activating other schemas in this change.

| History field | Contract                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| id            | History record's own generated primary key                               |
| row_id        | Text representation of source PK; composite columns in declared PK order |
| op            | I, U or D                                                                |
| changed_at    | Transaction timestamp; not precise within-transaction ordering           |
| changed_by    | Nullable integer, no foreign key to users                                |
| changed_via   | Nullable text                                                            |
| old_row       | JSONB before change; SQL NULL for INSERT                                 |
| new_row       | JSONB after change; SQL NULL for DELETE                                  |

Single PKs retain their text representation. Composite PKs use colon-separated
values with backslashes and colons escaped, preserving unambiguous identity.
For a PK-changing UPDATE, row_id identifies the new key; old_row retains the
old key. A DELETE uses the old key. This does not promise an immutable identity
across primary-key changes.

### Independently verifiable criteria

- **AC-1** — GIVEN the approved source schema WHEN the migration runs THEN
  exactly the 26 listed tables have same-named history tables and one capture
  trigger each, with no activation outside the allowlist.
- **AC-2** — GIVEN existing source rows WHEN tracking is enabled THEN no
  history is backfilled for those rows.
- **AC-3** — GIVEN a tracked table WHEN a row is inserted THEN one I record
  contains its key, SQL NULL old_row and masked new_row.
- **AC-4** — GIVEN a tracked row WHEN a non-ignored value changes THEN one U
  record contains its key and masked before/after snapshots.
- **AC-5** — GIVEN a tracked row WHEN it is deleted THEN one D record contains
  its old key, masked old_row and SQL NULL new_row.
- **AC-6** — GIVEN audited writes in a transaction WHEN history is captured
  THEN each changed_at equals the transaction timestamp.
- **AC-7** — GIVEN successful source and history writes WHEN their transaction
  commits THEN both are persisted.
- **AC-8** — GIVEN source and history writes WHEN their transaction rolls back
  THEN neither change is persisted.
- **AC-9** — GIVEN a deliberately failing history insertion WHEN a source write
  triggers it THEN the source statement fails and its changes are not persisted.
- **AC-10** — GIVEN a tracked row WHEN an UPDATE changes only configured
  ignored columns, or changes nothing, THEN no history record is created.
- **AC-11** — GIVEN an org WHEN name changes alongside updated or ao_count
  THEN a meaningful history record is created; ignored fields may remain in it.
- **AC-12** — GIVEN a configured sensitive column WHEN history is stored THEN
  neither snapshot retains its raw value. Test INSERT, UPDATE and DELETE
  independently for every approved sensitive column.
- **AC-13** — GIVEN a sensitive value WHEN only that value changes THEN a U
  record contains [redacted] in old_row and [redacted: changed] in new_row.
- **AC-14** — GIVEN an unchanged sensitive value WHEN another meaningful field
  changes THEN both snapshots contain [redacted] for the sensitive field.
- **AC-15** — GIVEN synthetic sensitive values WHEN an audited write fails
  THEN captured diagnostic output contains neither the old nor new raw value.
- **AC-16** — GIVEN an added, reviewed non-sensitive source column WHEN a row
  changes THEN its JSONB snapshot includes that column without a mirrored
  history-column migration.
- **AC-17** — GIVEN a source primary key WHEN tracking captures a row THEN
  row_id follows the data contract. Test single integer, UUID and composite
  keys independently, including escaped delimiters and declared column order.
- **AC-18** — GIVEN a primary-key-changing UPDATE WHEN history is captured
  THEN row_id identifies the new key and old_row retains the old key.
- **AC-19** — GIVEN a table without a primary key WHEN enable_tracking runs
  THEN it fails clearly without enabling capture or creating history objects.
- **AC-20** — GIVEN existing tracking WHEN the same configuration is enabled
  again THEN capture occurs once per meaningful write and history is preserved.
- **AC-21** — GIVEN existing tracking WHEN disable_tracking runs THEN subsequent
  writes are not captured and existing history remains intact.
- **AC-22** — GIVEN an invalid option column WHEN enable_tracking runs THEN it
  fails clearly without altering the prior tracking configuration or history.
- **AC-23** — GIVEN an incompatible existing history object WHEN enable_tracking
  runs THEN it fails clearly without changing that object or existing capture.
- **AC-24** — GIVEN existing tracking WHEN an operator re-enables it with valid
  changed options THEN those options replace the configuration for future
  writes only; existing history remains unchanged.
- **AC-25** — GIVEN a column in both ignore_cols and redact_cols WHEN tracking
  is enabled THEN configuration is rejected without changing existing tracking.
  This prevents silently suppressed secret rotations.
- **AC-26** — GIVEN a primary-key column in redact_cols WHEN tracking is enabled
  THEN configuration is rejected without changing existing tracking.
- **AC-27** — GIVEN no attribution settings WHEN a write is captured THEN
  changed_by and changed_via are SQL NULL.
- **AC-28** — GIVEN valid transaction-local app.user_id and app.source settings
  WHEN a write is captured THEN their values populate the attribution fields.
- **AC-29** — GIVEN malformed or out-of-range app.user_id WHEN a write occurs
  THEN the write succeeds with NULL changed_by. Accepted input is 1–10 ASCII decimal digits
  with numeric value 0–2147483647. Empty, signed, whitespace, decimal, oversized
  and non-numeric values produce NULL; leading zeroes within ten digits are accepted.
- **AC-30** — GIVEN an empty app.source WHEN a write is captured THEN changed_via
  is SQL NULL.
- **AC-31** — GIVEN attribution set locally in a completed transaction WHEN a
  later transaction on the same connection writes without context THEN its
  history attribution is NULL. Test after commit and rollback independently.
- **AC-32** — GIVEN a migrated test database WHEN an authorized real API-router
  mutation writes a tracked row THEN history is captured without an added audit call.
- **AC-33** — GIVEN a migrated test database WHEN an authorized direct SQL
  mutation writes a tracked row THEN history is captured without an added audit call.
- **AC-34** — GIVEN an operator has explicitly granted the reader role history
  access WHEN it selects history THEN SELECT succeeds
  for each of the 26 tables.
- **AC-35** — GIVEN a role without history access WHEN it selects history THEN
  access is denied for each of the 26 tables.
- **AC-36** — GIVEN an ordinary source writer or read-only user WHEN it directly
  inserts, updates or deletes history THEN access is denied. Test each action.
- **AC-37** — GIVEN an ordinary source writer or read-only user WHEN it enables
  or disables tracking or changes history schema THEN access is denied.
- **AC-38** — GIVEN a source writer without direct history-write privileges
  WHEN it performs an authorized source mutation THEN the trigger records history.
- **AC-39** — GIVEN a caller without source-write permission WHEN it attempts
  a source mutation THEN access is denied and no history is generated.
- **AC-40** — GIVEN the designated operator WHEN it enables or disables tracking
  THEN the requested operation succeeds under the documented grants.
- **AC-41** — GIVEN the supported local reset workflow WHEN reset and migrations
  complete THEN the exact approved trigger/table set is reproducibly available.

### Per-table options and review gate

The following matrix is derived from the checked-in Drizzle schema. An empty
option list is explicit; join tables do not have an updated column. Keys are
listed in declared constraint order. Personal data remains in historical
snapshots under the approved reader access; this is not an anonymized dataset.

| Table                         | Primary key                                       | Ignore            | Redact |
| ----------------------------- | ------------------------------------------------- | ----------------- | ------ |
| achievements                  | id                                                | updated           | (none) |
| achievements_x_users          | achievement_id, user_id, award_year, award_period | (none)            | (none) |
| api_keys                      | id                                                | updated           | key    |
| attendance                    | id                                                | updated           | (none) |
| attendance_types              | id                                                | updated           | (none) |
| attendance_x_attendance_types | attendance_id, attendance_type_id                 | (none)            | (none) |
| event_instances               | id                                                | updated           | (none) |
| event_instances_x_event_types | event_instance_id, event_type_id                  | (none)            | (none) |
| event_tags                    | id                                                | updated           | (none) |
| event_tags_x_event_instances  | event_instance_id, event_tag_id                   | (none)            | (none) |
| event_tags_x_events           | event_id, event_tag_id                            | (none)            | (none) |
| event_types                   | id                                                | updated           | (none) |
| events                        | id                                                | updated           | (none) |
| events_x_event_types          | event_id, event_type_id                           | (none)            | (none) |
| locations                     | id                                                | updated           | (none) |
| orgs                          | id                                                | updated, ao_count | (none) |
| orgs_x_slack_spaces           | org_id, slack_space_id                            | (none)            | (none) |
| permissions                   | id                                                | updated           | (none) |
| positions                     | id                                                | updated           | (none) |
| positions_x_orgs_x_users      | position_id, org_id, user_id                      | (none)            | (none) |
| roles                         | id                                                | updated           | (none) |
| roles_x_api_keys_x_org        | role_id, api_key_id, org_id                       | (none)            | (none) |
| roles_x_permissions           | role_id, permission_id                            | (none)            | (none) |
| roles_x_users_x_org           | role_id, user_id, org_id                          | (none)            | (none) |
| update_requests               | id                                                | updated           | token  |
| users                         | id                                                | updated           | (none) |

Adding a sensitive source column requires masking review before writes begin.
Renaming or dropping a masked column requires reviewed reconfiguration in the
same migration. Stale masked-column names fail source writes until corrected.
Changing masking configuration cannot sanitize previously collected history;
any historical remediation requires a separate reviewed decision.

Helper interface: audit.enable_tracking(target, ignore_cols, redact_cols), with
explicit empty defaults; table activation supplies each table's options.
Audit disablement is an operator action, not a routine write-path bypass.

## 5. Roles & authorization (RBAC)

No new API endpoint or UI exists, so database privileges are the access boundary.
Existing application authorization for source-table writes remains unchanged.
Existing oRPC procedure tiers and per-resource checks continue to authorize API
mutations; no new procedure tier or history-read endpoint is introduced.
Attribution settings are informational, not proof of identity or authorization.

| Action                                           | Allowed                                                                            | Explicitly denied                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| Read history                                     | Members of the verified existing read-only PostgreSQL role; designated owner/admin | Roles without an explicit applicable grant       |
| Generate history through source writes           | Roles already permitted to perform those source writes                             | Callers lacking source write authorization       |
| Directly insert/update/delete history            | Designated administrative owner only; automatic inserts through the trigger        | Ordinary application writers and read-only users |
| Enable/disable tracking or change history schema | Designated migration owner/operator                                                | Ordinary application writers and read-only users |

### Ownership and access

Run the migration as the designated source-table owner. The elevated capture
function and history tables have that owner. Ordinary application writers must
be separate roles with source DML grants, without ownership, history DML,
tracking-helper execution, or membership in the owner role. Source owners and
superusers can defeat capture; this is not a tamper-proof ledger.

Only INSERT, UPDATE and DELETE are captured. TRUNCATE and writes with triggers
disabled are not captured. Runtime roles must not have TRUNCATE privileges or
permission to disable/bypass triggers; verify those grants during preflight.

The migration does not grant history access to reader roles, including
`group_readonly`, or create production roles or memberships. The database operator
grants sister-schema USAGE and history-table SELECT separately to the intended
readers. Re-enablement removes non-owner direct table and column history grants,
so the operator must reapply intended reader grants afterward. It preserves all
collected history. Test access before and after manual provisioning for all
26 tables. Do not infer effective permissions from role names alone.

The helpers use invoker privileges and are executable only by their owner.
Operators should assume the designated migration-owner role. The capture
function uses SECURITY DEFINER with `pg_catalog, pg_temp` as its fixed search
path and parameterized snapshot insertion. Array trigger arguments preserve
column names without comma-delimited parsing ambiguity. Helper and history
grants must not expose general administrative privileges.

Historical personal data can survive source edits/deletions. The approved reader
access includes that data. Keep application logs, test fixtures and diagnostic
output free of real personal data and credentials.

## 6. Out of scope / non-goals

- Codex/auth table activation, schema creation, key additions or data repairs.
- Attribution middleware, app header changes or Python context integration.
- Audit UI/API, automatic restore, historical backfill, retention jobs,
  partitioning, or unrelated environment/tooling refactors.
- Automatic activation for tables added later.

Keep only setup/reset/preview changes needed to run and test this scoped
feature. Keep history schema management in custom migrations; avoid partial
schema declarations that make schema tooling propose deleting history tables.

## 7. Critical-path test cases

Use synthetic local/disposable data and real migrations, with tests for:

1. Exact activated table set; insert/update/delete snapshots and no-op suppression.
2. Cascading AO-count updates without spurious history, plus a meaningful edit.
3. API-key creation, rotation, unrelated edit and deletion with no stored secret.
4. UUID/composite/PK-changing rows, missing-PK refusal, enable/disable/re-enable.
5. Transaction rollback and deliberately failing history insertion.
6. Missing/valid/malformed attribution and no cross-transaction context leakage.
7. Source writer, read-only history reader and unauthorized-role permissions.
8. A real router mutation plus direct SQL capture; local reset reproducibility.

The paths above cover capture/masking (AC-1–14), attribution (AC-27–31),
permissions (AC-34–40), integration (AC-32/33) and reset (AC-41). All remaining
criteria also remain binding: include diagnostic redaction (AC-15), schema
changes (AC-16), key contracts (AC-17/18) and configuration validation/replacement
(AC-19–26) in the SQL/Vitest suite. Use explicit synthetic roles; tests run only
as the database owner do not prove privilege separation.

Testing approach approved in the linked review: use SQL/Vitest assertions for
database-only criteria rather than the Playwright assertions prescribed by
specs/README.md. These directly exercise transactions, trigger options, grants
and stored snapshots without introducing an audit UI. The application path below retains Playwright coverage.

Application critical path: drive one existing map update-request
submission through Playwright and verify its source row and corresponding
history through a test-only database assertion (AC-3/32). Use the existing flow and local/preview seed without adding a public
history endpoint for testing. The case belongs to the advisory tier; blocking placement requires
human approval under docs/E2E_TIERS.md.

Run the repository CI gates before proposing implementation ready.

### Local verification

The SQL integration tests live in
`packages/api/src/__tests__/audit-history.test.ts` so they use the existing real
migration/reset setup and run serially with other database-mutating API tests.
Run through the repository-pinned toolchain:

```bash
direnv exec . pnpm --filter @acme/api test src/__tests__/audit-history.test.ts
```

Only run against a verified local/disposable database ending in `_test`.
The test setup resets and seeds it; it must never point at production. Tests
exercise synthetic role grants using transactional CREATE ROLE, which requires
a local test administrator. The fixture schemas, roles and rows roll back.
Source writes in the API integration case commit, then are deleted; their
masked history remains until the next test reset.

Run `direnv exec . pnpm --filter f3-map test:e2e:audit` with Docker available.
The advisory Playwright case owns a temporary PostgreSQL container and fresh
map/API processes on allocated loopback ports. It migrates and seeds that database,
then uses a read-only connection to check stored history. It never uses supplied
`E2E_BASE_URL` or `E2E_AUDIT_DATABASE_URL` targets. Teardown stops its processes and
removes its container and data, including history, on success or failure.
The ordinary advisory suite skips this case unless `E2E_AUDIT_LOCAL=1` selects
the owned local fixture. No history endpoint is added. Logs remain in a private
`f3-audit-e2e-*` temporary directory for diagnosis. Do not run this alongside
other Next dev processes in the same checkout (Next holds a per-app dev lock).
Playwright reports and failure artifacts live under
`apps/map/node_modules/.cache/audit-e2e/`, outside the source lint scope.

## 8. Observability

- Events/metrics emitted via @acme/logger: reuse existing application failure
  events for affected write paths; introduce a new event only if a verified gap
  requires it. Verify diagnostic redaction with synthetic failures (AC-15).

Capture failures surface as database errors and fail the source transaction;
existing application error paths report failures without logging snapshots or
secret values. No new telemetry subsystem is required.

An audit failure returns a generic message with its SQLSTATE, without the original
database message/detail. Database statement logging is a separate operator setting
and must not log credential-bearing statements or bind values.

The shared `@acme/logger` boundary replaces audit errors with a fresh error
containing only the generic message and SQLSTATE before pino or the error-reporting
sink receives them. It covers all app/package error/fatal helpers and pino's
`err` serializer, including child loggers. Direct Sentry capture and other direct
database clients do not pass through that boundary; they must avoid logging query
parameters. This protection recognizes the database's exact audit-failure message;
the integration test feeds a real trigger failure through the logging sink.

## 9. Deployment and rollback

Migration `0027_public_audit_history.sql` creates `audit` helpers and same-named
`public_history` tables for the approved allowlist and column options above.

### Deployment preflight (human review required)

Local measurement on September 22, 2026: PostgreSQL 18.6 in Docker on this
Apple Silicon workstation, five batches of 1,000 INSERTs per table with a
1 KiB text field and one masked field. Median batch time was 16.64 ms without
tracking and 106.83 ms with tracking. The 5,000 history rows and their indexes
occupied 6,250,496 bytes. All benchmark objects were rolled back. This synthetic
single-session measurement is not a production latency or capacity estimate;
concurrent CI activity and hardware affect these numbers.

1. Through the approved production read-only procedure, verify all 26 tables,
   primary-key order, configured columns, absence of conflicting audit objects,
   source ownership, migration owner and runtime writer roles. Checked-in schema
   metadata and local measurements do not substitute for this inventory.
2. Select and manually provision the intended reader role. Review inherited role
   memberships and default ACLs, not just direct grants. Verify the operator can
   own all source/history objects and can create triggers/functions.
3. Measure representative write rates, payload sizes and retention/storage cost.
   Local fixtures demonstrate behavior only. Assign retention follow-up ownership
   before release; this migration does not delete or partition historical data.
   Include bulk transactions touching more than 64 audited rows while concurrent
   readers run. The per-row PL/pgSQL exception handler allocates subtransactions;
   exceeding PostgreSQL's cached-subxid capacity adds visibility-lookup work.
   Measure concurrent latency/throughput before rollout; the single-session
   benchmark above does not establish that impact. See PostgreSQL's
   [subtransaction documentation](https://www.postgresql.org/docs/18/subxacts.html).
4. Review migration locking with the team. Activation locks each source table;
   writes can wait until the migration transaction ends. Set an appropriate
   operator lock timeout and deploy window. The Drizzle migration transaction
   makes activation atomic; a failure must not leave a partially active set.
5. Obtain migration approval, execute through `packages/db` tooling, and verify
   exact activation, reader grants and representative source writes. Ask for team
   feedback on the approved policy that an audit insert failure fails its source
   statement. Do not assume multiple independent statements in an application
   request become one transaction because triggers were installed.

### Disablement and rollback

For an approved table, the operator may run
`SELECT audit.disable_tracking('public.<approved_table>'::regclass)` in a reviewed
transaction. Stop capture for the exact approved set; verify triggers are gone.
History remains readable. Re-enable with that table's explicit matrix options
when ready; no writes during the disabled interval are backfilled.

Do not roll back by dropping history schemas or deleting migration journal
entries. History deletion, restoration, or sanitizing previously captured data
requires a separate reviewed operation. Local/test reset is intentionally
separate: it destroys the disposable dataset and its history before rerunning
migrations. Before any schema drop, automated resets verify that the actual
database matches the configured `_test` database. Interactive resets do not require
an `_test` name: they instead require a matching database name, a loopback URL and
the database comment `f3-disposable-local-v1`, followed by confirmation explicitly
covering history deletion. The marker is installed on the development database
by `scripts/docker/init-db.sql` when Docker first initializes a volume, and by
`pnpm local:setup` directly through the local Docker container for existing volumes.
A refused or failed reset exits unsuccessfully. A localhost URL alone is
insufficient. Never mark a shared or production database disposable.
Drizzle's existing default public-only schema filter already excludes
the migration-owned audit/history schemas from push/pull management. This feature
does not broaden that tooling scope to auth.

### Review status and rollout decisions

- Core design and detailed criteria: approved by Tackle in the linked review.
- Configuration replacement and conflicting-option rejection: implemented as specified.
- The unsigned integer attribution grammar is defined in AC-29.
- update_requests.token is currently transported as metadata in the API output
  and map request form; no authorization comparison was found in repository
  consumers. It is masked because retaining the value is unnecessary for
  history. This does not change source-table behavior or API authorization.
- Reader access is provisioned manually by the database operator. The migration
  does not grant history access to group_readonly or other reader roles, create
  production roles, or grant role membership.
- Ask the team for feedback on fail-the-source-write behavior with the implementation.
- Production migration approval, representative production sizing and retention
  ownership remain release decisions; local tests do not establish production readiness.
