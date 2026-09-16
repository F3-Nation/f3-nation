# Territory migration rehearsal and rollback

## Local rehearsal

From the repository root, with the existing `f3-local` PostgreSQL container running:

```bash
bash packages/db/scripts/verify-territory-migration.sh
```

The script verifies the container's Compose project label, creates two uniquely
named temporary databases, applies migrations through 0022, and inserts only
synthetic organizations and positions. It dumps that populated database using
`pg_dump -Fc`, restores the archive into the second database, and exercises the
forward migration, rollback, reapplication, and rollback-refusal cases. It
removes only its two temporary databases on exit and prints the retained
synthetic archive/log directory. Existing development/test databases are not
reset by this script.

### Evidence — September 15, 2026

The initial rehearsal passed against the existing local `postgres:18.4-trixie`
container. A subsequent rehearsal also passed against the exact PostgreSQL 18.6
image pinned by Compose and CI:

```text
postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280
```

The rerun verified server version `18.6 (Debian 18.6-1.pgdg13+2)` in a disposable
container with networking disabled and no published ports. It used the same
rehearsal script with only the container name and repository root adjusted.
The container was removed afterward; existing development/test databases were
untouched. Both rehearsals verified:

- 5,000 organizations in five-level chains, including inactive records and
  JSON metadata; 6,000 positions covering every old enum value and null.
- Complete JSON row comparisons before/after forward and reverse migration.
- Exact enum declaration order, both column types/nullability, and identical
  index definition with `indisvalid = true`.
- Rollback rejects a Territory organization and, independently, a Territory
  position. After each refusal, the six-member enum, original rows, and index
  remain intact.

This is a restored, production-shaped **synthetic** dump: the full schema,
constraints, triggers, and indexes come from repository migrations through 0022. It is not a production export and cannot reveal production-only schema
drift, extra enum dependencies, privileges, concurrent lock contention, or
production performance. No production connection was made. Release review must
account for those limitations rather than treating this as production verification.

## Forward migration deployment

Schedule a maintenance window for 0023 and coordinate application writers before
running it. Converting both columns to text and back rewrites the tables and
takes `ACCESS EXCLUSIVE` locks; waiting for those locks can also queue application
queries. The migration SQL does not set a lock timeout. Before execution, set and
verify a finite `lock_timeout` on the actual migration connection (for example,
3 seconds, subject to the target's release plan). Verify the effective
`statement_timeout` separately and size it using target-environment rehearsal;
the synthetic test does not establish a production duration budget.

Use the repository's Drizzle migrator so the schema changes and migration
journal entry share a transaction. The installed `drizzle-orm` implementation
(`pg-core/dialect.js`, `PgDialect.migrate`) wraps pending migration statements
and journal writes in `session.transaction`. The local rehearsal uses `psql -1`
to test the SQL in a transaction; it does not execute or fault-test the Drizzle
runner itself. Recheck that transaction boundary when changing the runner or
upgrading Drizzle. Do not execute the forward SQL as separate autocommit steps.

If lock acquisition or a statement fails, investigate the blocker and confirm
the schema and journal state before retrying. Verify the six enum values, both
column types, index validity, and the applied 0023 journal entry before resuming
writers; command completion alone is not evidence that the migration applied.
Production execution still requires the normal target and command approval.

## Operator-led rollback

`rollback-territory-org-type.sql` runs transactionally, locks both dependent
tables, refuses to proceed if either contains Territory, and reconstructs the
original five-member enum and index. Run with `psql -X -v ON_ERROR_STOP=1`
against an explicitly approved target. The SQL intentionally lives outside the
forward-migration directory.

Before a release rollback:

1. Stop application writers and automated migration runners; verify the exact
   target, deployment versions, and that 0023 is the latest applied migration.
   If subsequent migrations exist, devise a rollback for that actual state.
2. Back up the database and its Drizzle journal. Confirm no Territory values
   exist in either dependent column. Coordinate restoring the pre-Territory
   application build while writers remain stopped.
3. Run the rollback SQL and verify enum order, preserved rows, column
   nullability, and index validity/definition.
4. Reconcile the target's Drizzle journal under separately reviewed exact SQL:
   remove only the applied 0023 entry identified by its migration hash and
   journal timestamp. Do not clear the journal or change older entries. The
   table name is environment-dependent (`__drizzle_migrations_<database>`).
5. Resume only the coordinated application/migration versions. Retaining 0023
   in a deployed migration directory while removing its journal entry causes
   the next migration run to reapply it.

The local rehearsal verifies the schema rollback, not a production deployment
or production journal mutation. Production rollback and exact journal SQL
require the normal human release approval.
