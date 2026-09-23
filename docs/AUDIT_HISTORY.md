# Database audit history

The [approved feature spec](../specs/database-audit-history.md) defines the exact
26-table allowlist and column options. Migration `0027_public_audit_history.sql`
creates `audit` helpers and same-named `public_history` tables. There is no
backfill, UI, history API, or attribution middleware in this change.

## Ownership and access

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
grants schema USAGE and history-table SELECT separately to the intended readers.
Re-enablement removes non-owner direct table and column history grants, so the
operator must reapply intended reader grants afterward. It preserves all collected
history.

The helpers use invoker privileges and are executable only by their owner.
Operators should assume the designated migration-owner role. The capture
function uses SECURITY DEFINER with `pg_catalog, pg_temp` as its fixed search
path and parameterized snapshot insertion. Array trigger arguments preserve
column names without comma-delimited parsing ambiguity.

Historical personal data can survive source edits/deletions. The approved reader
access includes that data. Keep application logs, test fixtures and diagnostic
output free of real personal data and credentials. `api_keys.key` and
`update_requests.token` are masked in every stored snapshot. An audit failure
returns a generic message with its SQLSTATE, without the original database
message/detail. Database statement logging is a separate operator setting and
must not log credential-bearing statements or bind values.

The shared `@acme/logger` boundary replaces audit errors with a fresh error
containing only the generic message and SQLSTATE before pino or the error-reporting
sink receives them. It covers all app/package error/fatal helpers and pino's
`err` serializer, including child loggers. Direct Sentry capture and other direct
database clients do not pass through that boundary; they must avoid logging query
parameters. This protection recognizes the database's exact audit-failure message;
the integration test feeds a real trigger failure through the logging sink.

Renaming or dropping a masked column requires re-enabling tracking with reviewed
column options in the same migration. Stale masking configuration fails source
writes, including otherwise ignored updates, rather than storing unmasked values.

## Local verification

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

## Deployment preflight (human review required)

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

## Disablement and rollback

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
