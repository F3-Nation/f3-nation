# Changing Postgres enums in migrations

Guidance for migrations that touch an enum such as `org_type`. Read it before
writing one, and before deploying a batch of pending migrations.

## Prefer in-place changes

- Add a value with `ALTER TYPE ... ADD VALUE ... BEFORE|AFTER`.
- Rename one with `ALTER TYPE ... RENAME VALUE`.

Both keep the type's OID, so dependent views, indexes, functions and cached
plans are untouched, and neither rewrites tables or takes table locks. Removing
or reordering values is the only case that needs the type recreated; avoid it.

## Views created outside the migrations

Staging and Production can carry views that no repository migration creates
(for example `event_instance_expanded`, which joins on `org_type`). Local and CI
databases are built only from migrations, so they don't have these views and
won't catch a failure they cause.

Postgres refuses to change a column's type, or drop a type, while a view depends
on it (`cannot alter type of a column used by a view or rule`). A migration that
recreates an enum (cast columns to `text`, `DROP TYPE`, `CREATE TYPE`, cast
back) therefore fails against those environments unless it first drops and
later recreates every dependent view with the same definition, options, owner,
grants and comment.

To list what depends on an enum in a target database (shown for `org_type`):

```sql
SELECT DISTINCT r.ev_class::regclass AS view
FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
WHERE d.classid = 'pg_rewrite'::regclass
  AND ((d.refclassid = 'pg_type'::regclass AND d.refobjid = 'public.org_type'::regtype)
    OR (d.refclassid = 'pg_class'::regclass
      AND d.refobjid IN ('public.orgs'::regclass, 'public.positions'::regclass)
      AND d.refobjsubid = (SELECT attnum FROM pg_attribute
        WHERE attrelid = d.refobjid AND attname = 'org_type')));
```

Views stacked on those views are not listed; follow the dependencies.

## If you do recreate an enum

- Re-issue with `CREATE OR REPLACE` every function that references the type
  (for `org_type`: `update_org_ao_counts`, `recount_org_ao_counts`,
  `org_ao_count_expected`, `org_ao_count_targets`). Otherwise long-lived
  sessions keep plans for the old type and fail with `cache lookup failed for
type`.
- Recycle application DB pools and server-side connections afterwards, since
  the recreated type has a new OID.
- Bound lock acquisition with a transaction-local `lock_timeout`; recreation
  rewrites the tables and takes `ACCESS EXCLUSIVE` locks, so schedule a
  maintenance window.

## Deploying a batch of migrations

- **One transaction.** Drizzle applies all pending migrations, and their journal
  rows, in a single transaction. Postgres forbids using a value added by
  `ADD VALUE` before that transaction commits, so no migration in the same batch
  may reference the new value. Compare against `org_type::text` instead, or
  ship the use in a later release.
- **The runner can silently skip.** It skips migration entirely when `CI` is
  set, still logs `Migration done`, and exits zero. Run it with `env -u CI`, and
  verify the schema and journal afterwards rather than trusting its output.
- **Newest-timestamp rule.** The runner compares each migration's journal `when`
  with the newest `created_at` in the journal table and runs only newer ones; it
  never checks whether an individual migration has a row. Deleting an older
  migration's journal row does not make the runner apply it again, and a
  migration with an older `when` than the newest applied row is never run. Keep
  `when` values increasing.
- **Journal table name.** The table lives in the `drizzle` schema and its suffix
  comes from the final segment of the database URL (including any query string),
  so inspect the actual name before writing SQL against it.
