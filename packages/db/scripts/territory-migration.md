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
forward migration, rollback, reapplication, and rollback-refusal cases. It then
rehearses the rollback's Drizzle journal reconciliation in three further temporary
databases built by the repository's real migration runner (`src/migrate.ts`, so
`node` and installed dependencies are required): one shows that reconciling the
journal alone does not bring Territory back, and two apply the recovery in
[Restoring Territory after a rollback](#restoring-territory-after-a-rollback),
one before and one after a runner pass has re-applied 0026. Each recovery checks
the live `update_org_ao_counts()` body, not just the enum and journal.
It removes only its five temporary databases on exit and prints the retained
synthetic archive/log directory. Existing development/test databases are not
reset by this script, and the runner is pinned away from `TEST_DATABASE_URL`, so
a `NODE_ENV=test` shell cannot redirect it onto another database.

For an isolated container, set `TERRITORY_TEST_CONTAINER` to its name; it must
still carry the `f3-local` Compose-project label and use the same local DB user.
The journal stage connects from the host, so the container must publish
PostgreSQL's port.
Use the pinned PostgreSQL 18.6 image below. The rehearsal keeps a backend open
across forward and reverse migration and verifies writes on that same backend.
It also holds a conflicting lock to verify the forward timeout leaves the
original schema/data intact, and tests rollback refusal without a command-line
`ON_ERROR_STOP` flag.

### Evidence — September 15–16, 2026

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

The persistent-session regression initially reproduced `cache lookup failed for
type` in `update_org_ao_counts()` on PostgreSQL 18.6. Recreating the existing
function within each enum-replacement transaction fixes that failure; the same
session now inserts, updates, and deletes organizations after both directions.
The extended rehearsal also passed the lock-timeout and standalone refusal checks.

This is a restored, production-shaped **synthetic** dump: the full schema,
constraints, triggers, and indexes come from repository migrations through 0022. It is not a production export and cannot reveal production-only schema
drift, extra enum dependencies, privileges, concurrent lock contention, or
production performance. No production connection was made. Release review must
account for those limitations rather than treating this as production verification.

## Forward migration deployment

Schedule a maintenance window for 0023 and coordinate application writers before
running it. Converting both columns to text and back rewrites the tables and
takes `ACCESS EXCLUSIVE` locks; waiting for those locks can also queue application
queries. The migration sets `SET LOCAL lock_timeout = '3s'` before acquiring
locks. Drizzle applies the pending batch in one transaction, so this setting
also applies to any later migrations in that batch until the transaction ends.
Review the complete pending batch before deployment. Verify the effective
`statement_timeout` separately and size it using target-environment rehearsal;
the synthetic test does not establish a production duration budget.

From the repository root, use `env -u CI pnpm db:migrate` with the separately
approved target configured through the repository's `with-env` helper. Never
add `--reset` or `--seed` to a production migration. The current runner skips
migration entirely when `CI` is set and can exit zero after logging a failure;
neither its exit code nor the completion message establishes success. The
post-run schema and journal checks below are mandatory.

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
The migration refreshes the known `update_org_ao_counts()` trigger function to
invalidate its cached enum references. Before resuming writers, recycle database
connections for every application, including SQLAlchemy pools and PgBouncer's
server connections. Restarting application clients alone does not necessarily
replace PgBouncer's PostgreSQL backends. This covers production-only functions
or cached statements that the repository rehearsal cannot inventory.
Production execution still requires the normal target and command approval.

## Operator-led rollback

`rollback-territory-org-type.sql` runs transactionally, locks both dependent
tables, refuses to proceed if either contains Territory, and reconstructs the
original five-member enum and index. The file sets `\set ON_ERROR_STOP on`
itself so a refusal exits nonzero even when the caller omits the flag.
Run with `psql -X -v ON_ERROR_STOP=1`
against an explicitly approved target. The SQL intentionally lives outside the
forward-migration directory.

Before a release rollback:

1. Stop application writers and automated migration runners; verify the exact
   target, deployment versions, and that the applied migrations above 0022 are
   0023 through 0025, plus the AO-count migration 0026 when it was applied. 0024
   and 0025 (Better Auth foreign keys and the email-sync trigger) do not touch
   `org_type` or AO counts, and this script does not reverse them. If any other
   migration is applied, devise a rollback for that actual state. When 0026 is
   applied, the script also restores the fixed-depth trigger function and removes
   its recount functions.
2. Back up the database and its Drizzle journal. Confirm no Territory values
   exist in either dependent column. Coordinate restoring the pre-Territory
   application build while writers remain stopped.
3. Run the rollback SQL and verify enum order, preserved rows, column
   nullability, and index validity/definition.
4. Reconcile the target's Drizzle journal under separately reviewed exact SQL:
   remove only the applied 0023 entry, and the 0026 entry when it was applied,
   each identified by its migration hash and journal timestamp. Leave the 0024
   and 0025 entries in place, since the script does not reverse them. Do not clear
   the journal or change older entries. The
   table is in the `drizzle` schema. Inspect its actual name before writing SQL:
   the current runner derives the suffix from the final segment of the database
   URL, including any query string, so it may differ from the bare database name.
   The usual name is `drizzle."__drizzle_migrations_<database>"`. Match the 0023 row on
   `hash` (SHA-256 of the exact deployed SQL file) and `created_at = 1789505471619`
   (its `_journal.json` `when`); the 0026 row uses `created_at = 1789775437096`.
5. Recycle application DB pools and PgBouncer server connections as for forward
   migration, then resume only the coordinated application/migration versions.
   Removing 0023's journal entry does not make the runner apply it again; see
   below before deploying any build that still contains 0023 through 0026.

The local rehearsal verifies the schema rollback, not a production deployment
or production journal mutation. Production rollback and exact journal SQL
require the normal human release approval.

### Restoring Territory after a rollback

Drizzle's runner (`PgDialect.migrate`, read at `drizzle-orm` 0.45.2) compares each
migration's journal `when` with the **newest** `created_at` in the journal table
and runs only the migrations that are newer. It never checks whether an
individual migration has a row. After step 4 the newest remaining row is 0025
(`created_at = 1789695365192`), so on the next runner pass:

- 0023 (`1789505471619`) is not selected, even though its row is gone and its file
  is still in the migration directory. The schema keeps the five-member enum and
  Territory creation fails.
- 0026 (`1789775437096`) is newer than 0025 and runs again. It never references
  Territory, so it applies cleanly to the five-member enum.
- The runner still logs `Migration done`. It also exits zero after logging a
  failure, so check the schema and journal rather than its output.

Do not deploy a build that contains 0023 through 0026 to a rolled-back database
and expect Territory to return. Restore it explicitly, in a maintenance window
like the forward migration:

1. Stop application writers and automated migration runners. Back up the database
   and its journal. Confirm the enum has five members and the journal has the
   0022, 0024, and 0025 rows and no 0023 row.
2. Apply 0023's exact SQL and its journal row in **one transaction**, so the enum
   change and the journal write succeed or fail together as they would under the
   runner. Use the journal table name inspected in step 4 of the rollback:

   ```sql
   -- run with psql -1, after the exact contents of 0023_add_territory_org_type.sql
   INSERT INTO drizzle."__drizzle_migrations_<database>" ("hash", "created_at")
   VALUES ('<SHA-256 of the exact deployed 0023 file>', 1789505471619);
   ```

3. Verify the six enum values, both column types, index validity, and the 0023
   journal row before resuming writers, then recycle application DB pools and
   PgBouncer server connections as for forward migration.
4. Deploy the coordinated build. The runner now finds only the migrations newer
   than 0025 that are not yet applied (0026, when its row was removed) and applies
   them in their original order. Afterwards confirm the live trigger is 0026's;
   this must return `f`:

   ```sql
   SELECT pg_get_functiondef('public.update_org_ao_counts'::regproc) ILIKE '%great_grandparent%';
   ```

If a runner pass has already re-applied 0026, do **not** apply the transaction
above unchanged. 0023 also defines `update_org_ao_counts()`, with the old
fixed-depth body, so applying it over the re-applied 0026 puts that trigger back:
an AO under Sector, Territory, Area, and Region would stop updating the Sector's
count, and intermediate moves and deactivations would stop triggering recounts.
The runner never repairs this, because 0026 stays recorded as applied. Add one
statement to the same transaction, removing 0026's row exactly as in step 4 of the
rollback (match `hash` and `created_at = 1789775437096`):

```sql
DELETE FROM drizzle."__drizzle_migrations_<database>"
WHERE "hash" = '<SHA-256 of the exact deployed 0026 file>'
  AND "created_at" = 1789775437096;
```

The runner then re-applies 0026 after 0023. Its functions are `CREATE OR REPLACE`
and its backfill is idempotent, so this restores the depth-agnostic trigger and
recounts. Verify with the trigger check in step 4, and recycle every pooled
connection, because 0023 replaces the enum that 0026's functions reference.

The alternative is to ship Territory as a new migration with a fresh, later
`when`. Its SQL must then also re-issue `update_org_ao_counts`,
`recount_org_ao_counts`, `org_ao_count_expected`, and `org_ao_count_targets` (see
[Future enum-recreation migrations](#future-enum-recreation-migrations)), and 0026 would run before it.
The rehearsal does not cover this route, so it needs its own review.

`verify-territory-migration.sh` rehearses the trap and both recovery orderings above
against databases built by the real runner, using the same journal edit as step 4. Those
databases are fresh synthetic ones, so the production journal table name and any
production-only drift still have to be checked on the actual target.

## Populated Territory rollout

Migration 0026 replaces the fixed three-ancestor AO counting with a depth-agnostic
recount. `orgs.ao_count` is carried by every organization type except AO and
Nation. It is the number of active AOs in the organization's subtree, reached only
through active intermediate organizations; the organization's own status is not
checked. The trigger, the migration backfill, and `pnpm db:seed` all call
`recount_org_ao_counts()`, so Sector and Territory counts stay correct for an
Area directly under a Sector, an Area under a Territory, and any move between them.

`assertValidParentType` accepts an Area beneath either a Sector or a Territory, so
Areas can be reparented gradually. Direct SQL writes bypass that validation and
the trigger may be disabled or bypassed; see below for repairing counts.

### Verifying counts during rollout

0026 runs a full backfill, which also corrects drift that predates it (deleted
AOs, moves, and intermediate deactivations were never recounted). Some stored
counts can therefore change when it is applied. To review the change, export the
stored counts before the migration and again after it, then compare:

```sql
SELECT id, org_type, name, ao_count
FROM orgs
WHERE org_type::text NOT IN ('ao', 'nation')
ORDER BY id;
```

The migration prints how many rows it corrected. At any later time this
read-only query lists organizations whose stored count differs from the expected
one:

```sql
SELECT o.id, o.name, o.ao_count, e.expected
FROM orgs o
JOIN org_ao_count_expected() e ON e.org_id = o.id
WHERE o.ao_count IS DISTINCT FROM e.expected;
```

`SELECT recount_org_ao_counts();` repairs every count and returns how many rows it
changed. Run it after any direct SQL edit that changes an organization's parent,
active status, or type while the trigger is disabled or bypassed. An
`app.disable_ao_count_trigger` setting of `true` skips the trigger; an empty or
`false` value does not.

### Future enum-recreation migrations

`update_org_ao_counts`, `recount_org_ao_counts`, `org_ao_count_expected`, and
`org_ao_count_targets` reference `org_type`. A migration that recreates the enum
must re-issue each with `CREATE OR REPLACE`, alongside the connection recycling
described above, so long-lived sessions do not keep plans for the old enum type.
Adding a tier between Nation and AO needs no change to their type lists.
