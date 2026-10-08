# Postgres migrations

Guidance for writing and deploying database migrations, and for operating on
the data they leave behind. Read the enum section before writing a migration
that touches an enum such as `org_type`, and the deployment section before
deploying a batch of pending migrations.

## Changing enums

### Prefer in-place changes

- Add a value with `ALTER TYPE ... ADD VALUE ... BEFORE|AFTER`.
- Rename one with `ALTER TYPE ... RENAME VALUE`.

Both keep the type's OID, so dependent views, indexes, functions and cached
plans are untouched, and neither rewrites tables or takes table locks. Removing
or reordering values is the only case that needs the type recreated; avoid it.

### Views created outside the migrations

Staging and Production can carry views that no repository migration creates.
Local and CI databases are built only from migrations, so they don't have these
views and won't catch a failure they cause.

Postgres refuses to change a column's type, or drop a type, while a view depends
on it (`cannot alter type of a column used by a view or rule`). A migration that
recreates an enum (cast columns to `text`, `DROP TYPE`, `CREATE TYPE`, cast
back) therefore fails against those environments unless it first drops and
later recreates every dependent view with the same definition, options, owner,
grants and comment.

List what depends on the enum, and on any column that uses it, in the target
database before writing the migration. Replace the placeholders with the enum,
the tables that have a column of that type, and the column name. Add one entry
to the `IN (...)` list for each such table; if the column has a different name
in some of them, run the query once per name:

```sql
SELECT DISTINCT r.ev_class::regclass AS view
FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
WHERE d.classid = 'pg_rewrite'::regclass
  AND ((d.refclassid = 'pg_type'::regclass
      AND d.refobjid = 'public.<enum_type>'::regtype)
    OR (d.refclassid = 'pg_class'::regclass
      AND d.refobjid IN ('public.<table_a>'::regclass,
        'public.<table_b>'::regclass)
      AND d.refobjsubid = (SELECT attnum FROM pg_attribute
        WHERE attrelid = d.refobjid AND attname = '<column>')));
```

Views stacked on those views are not listed; follow the dependencies.

### If you do recreate an enum

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

## Deploying migrations

**Staging and prod are migrated only from main, after the pull request is
merged**, with one of three commands, run from the repository root:

| Command                   | Migrates                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:migrate:local`   | The local database in `packages/db/.env`. `pnpm db:migrate` is the same command.                                                     |
| `pnpm db:migrate:staging` | `f3_staging`, with the login in Secret Manager secret `MIGRATE_DATABASE_URL_STAGING` (project `f3data`). Ignores `packages/db/.env`. |
| `pnpm db:migrate:prod`    | `f3_prod`, with the login in secret `MIGRATE_DATABASE_URL_PROD`. Ignores `packages/db/.env`.                                         |

On 2026-10-08 `pnpm db:migrate` was run from an unmerged branch with a prod URL
in `packages/db/.env`, and applied that branch's migrations to prod. These
commands make that refuse. Each check prints what to do when it refuses, and
nothing is changed until every check passes:

- **Local only** (`db:migrate`, `db:migrate:local`): the URL must point at
  `localhost`, `127.0.0.1`, `::1` or a local socket (not `/cloudsql/…`), the
  database must not be named like staging or prod, and the server must not be
  Cloud SQL (which also catches a cloud-sql-proxy on localhost).
- **Staging and prod** (`db:migrate:staging`, `db:migrate:prod`):
  1. Run by a person in a terminal: they ask you to type the database name.
     There is no `--yes`.
  2. After `git fetch` of F3-Nation/f3-nation's `main`, `packages/db/drizzle`
     must be exactly main's, or the checkout must be a commit on main (a
     release commit behind main is fine), with no uncommitted or untracked
     files under `packages/db/drizzle`.
  3. The URL must name the database exactly (`f3_staging` / `f3_prod`) with no
     other URL parameters, since they would rename the migrations table (see
     "Journal table name" below) and Drizzle would re-run every migration.
  4. Read-only first: the server's `current_database()` must be that database;
     the login must own every table in `public`, `auth`, `slackbot` and
     `drizzle` (on prod that is `f3slackbot`, not the apps' logins); and the
     database's migration rows must agree with the checkout's journal:
     - a row the journal has no entry for refuses ("migrations this checkout
       doesn't know about"): unmerged migrations were applied, or the
       checkout is older than what is deployed;
     - a journal entry the database lacks, older than its newest row, refuses:
       Drizzle would skip it silently forever (see the newest-timestamp rule
       below). Known exceptions are listed per environment in
       `packages/db/src/migrate-guards.ts` (prod: `0008_nice_leech`, applied
       to staging but never to prod);
     - a row whose hash differs from the file is only noted: the file was
       edited after it ran (prod's `0011` and `0015`), and Drizzle ignores it.
  5. It lists the pending migrations and asks you to type the database name.
     Then it applies them (in one transaction) and checks the database is at
     the newest one.

**Connecting.** The secret holds a full `postgresql://` URL, used as is. If
it points at `127.0.0.1:<port>`, start the Cloud SQL proxy on that port first
(`cloud-sql-proxy f3data:us-central1:f3data --port <port>` for prod,
`…:f3data-nonprod` for staging); a Cloud SQL socket (`?host=/cloudsql/…`)
works where one is mounted. Your own `gcloud` login reads the secret.

**What an admin sets up once.** In project `f3data`, secrets
`MIGRATE_DATABASE_URL_STAGING` and `MIGRATE_DATABASE_URL_PROD`, each a URL for
a login that owns the schema objects of that database (on prod `f3slackbot`
owns them), and `roles/secretmanager.secretAccessor` on them for whoever runs
migrations. For unusual cases: `MIGRATE_SECRET` / `MIGRATE_SECRET_PROJECT`
read a different secret, and `MIGRATE_DATABASE_URL` supplies a URL directly;
every check still applies.

## Deploying a batch of migrations

- **One transaction.** Drizzle applies all pending migrations, and their journal
  rows, in a single transaction. Postgres forbids using a value added by
  `ADD VALUE` before that transaction commits, so no migration in the same batch
  may reference the new value. Compare against `org_type::text` instead, or
  ship the use in a later release.
- **The local runner can silently skip.** `pnpm db:migrate` skips migration
  entirely when `CI` is set, still logs `Migration done`, and exits zero. Run
  it with `env -u CI`. (`db:migrate:staging` / `db:migrate:prod` don't read
  `CI`, and check the database is at the newest migration afterwards.)
- **Newest-timestamp rule.** The runner compares each migration's journal `when`
  with the newest `created_at` in the journal table and runs only newer ones; it
  never checks whether an individual migration has a row. Deleting an older
  migration's journal row does not make the runner apply it again, and a
  migration with an older `when` than the newest applied row is never run. Keep
  `when` values increasing.
- **Journal table name.** The table lives in the `drizzle` schema and is named
  `__drizzle_migrations_<name>`. The runner takes `<name>` from the final
  `/`-separated segment of the database URL, after removing a Cloud SQL socket
  `host=` parameter. Any other query parameters stay in the name:
  `…@/f3_prod?host=/cloudsql/…` gives `f3_prod`, while
  `…@/f3_prod?host=/cloudsql/…&sslmode=disable` gives
  `f3_prod?sslmode=disable`. Inspect the actual table name before writing SQL
  against it.

## AO counts

`orgs.ao_count` is maintained by a trigger and can drift when rows change
without it (see
[`admin-territory-management.md`](../specs/admin-territory-management.md) for
the intended behavior). To list organizations whose stored count differs from
the expected one, run this read-only query:

```sql
SELECT o.id, o.name, o.ao_count, e.expected
FROM orgs o
JOIN org_ao_count_expected() e ON e.org_id = o.id
WHERE o.ao_count IS DISTINCT FROM e.expected;
```

`SELECT recount_org_ao_counts();` repairs every count and returns how many rows
it changed. Run it after any direct SQL edit that inserts or deletes an
organization, or changes its parent, active status, or type, while the trigger
is disabled or bypassed. An
`app.disable_ao_count_trigger` setting of `true` skips the trigger; an empty or
`false` value does not.
