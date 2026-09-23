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

The database operator grants sister-schema USAGE and history-table SELECT
manually; the migration must not automatically grant access to an existing
read-only role. Re-enablement removes non-owner direct history grants, so intended
reader grants must be reapplied manually afterward. Test access before and after
manual provisioning for all 26 tables. Do not infer effective permissions from
role names alone. Elevated trigger functions use a fixed safe search path;
helper and history grants must not expose general administrative privileges.
Database owners can alter history: this is not a tamper-proof security ledger.

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

## 8. Observability

- Events/metrics emitted via @acme/logger: reuse existing application failure
  events for affected write paths; introduce a new event only if a verified gap
  requires it. Verify diagnostic redaction with synthetic failures (AC-15).

Capture failures surface as database errors and fail the source transaction;
existing application error paths report failures without logging snapshots or
secret values. No new telemetry subsystem is required.

### Rollout

Before release, verify selected production tables/keys, the actual read-only
role, migration ownership and runtime grants through the approved preflight.
Measure representative local write overhead and storage growth; do not claim
production performance from small fixtures. Track retention as a follow-up.
Rollback/disablement must preserve collected history; destructive history
cleanup requires a separate decision. Obtain human migration approval.

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

See [audit rollout](../docs/AUDIT_HISTORY.md) for deployment and rollback details.
