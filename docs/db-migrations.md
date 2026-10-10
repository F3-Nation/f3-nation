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
| `pnpm db:migrate:local`   | The local database in `packages/db/.env`.                                                                                            |
| `pnpm db:migrate:staging` | `f3_staging`, with the login in Secret Manager secret `MIGRATE_DATABASE_URL_STAGING` (project `f3data`). Ignores `packages/db/.env`. |
| `pnpm db:migrate:prod`    | `f3_prod`, with the login in secret `MIGRATE_DATABASE_URL_PROD`. Ignores `packages/db/.env`.                                         |

There is no plain `pnpm db:migrate` any more. On 2026-10-08 it was run from an
unmerged branch with a prod URL in `packages/db/.env`, and applied that
branch's migrations to prod. These commands make that refuse. Each check prints what to do when it refuses, and
nothing is changed until every check passes:

- **Local only** (`db:migrate:local`): the URL must point at
  `localhost`, `127.0.0.1`, `::1` or a local socket (not `/cloudsql/…`), the
  database must not be named like staging or prod, and the server must not be
  Cloud SQL (which also catches a cloud-sql-proxy on localhost). It also
  refuses when `CI` is set; a CI job that migrates its own throwaway database
  (`preview-env.yml`) runs it with `CI=`.
- **Staging and prod** (`db:migrate:staging`, `db:migrate:prod`):
  1. Run by a person in a terminal: they ask you to type the database name.
     There is no `--yes`.
  2. After `git fetch` of F3-Nation/f3-nation's `main`, `packages/db` (the
     migrations and the code that applies them) and the root `package.json`
     must be exactly main's, or the checkout must be a commit on main (a
     release commit behind main is fine), with no uncommitted or untracked
     files in either. A branch that changes neither can still run it.
  3. The URL must name the database exactly (`f3_staging` / `f3_prod`) with no
     other URL parameters, since they would rename the migrations table (see
     "Journal table name" below) and Drizzle would re-run every migration.
  4. Read-only first: the server's `current_database()` must be that database;
     the login must own (directly or through role membership) every table,
     type and function in schemas tracked by drizzle (`public`, `auth`,
     `slackbot` and `drizzle`; extension members aside), and may create
     objects in them and new schemas (see [Database roles](#database-roles));
     and the database's migration rows must agree with the checkout's
     journal:
     - a row the journal has no entry for refuses ("migrations this checkout
       doesn't know about"): unmerged migrations were applied, or the
       checkout is older than what is deployed;
     - a journal entry the database lacks, older than its newest row, refuses,
       because Drizzle would never run it (see "Drizzle skips older
       migrations" below). Known exceptions are listed per environment in
       `packages/db/src/migrate-guards.ts` (prod: `0008_nice_leech`, applied
       to staging but never to prod);
     - a row whose hash differs from the file is only noted: the file was
       edited after it ran (staging's `0011`, prod's `0015`), and Drizzle ignores it.
  5. It lists the pending migrations and asks you to type the database name.
     Then it applies them (in one transaction) and checks the database is at
     the newest one.

**Connecting.** The secret holds a full `postgresql://` URL, used as is and
never printed. Both secrets point at a local Cloud SQL proxy, so start it in
another terminal first and leave it running:

| Command                   | Start this first                                                |
| ------------------------- | --------------------------------------------------------------- |
| `pnpm db:migrate:staging` | `cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5482` |
| `pnpm db:migrate:prod`    | `cloud-sql-proxy f3data:us-central1:f3data --port 5481`         |

The proxy uses Application Default Credentials: run
`gcloud auth application-default login` once on your machine. If the proxy
isn't running, the command says which address it tried and prints the proxy
command. A Cloud SQL socket URL (`?host=/cloudsql/…`) also
works where one is mounted. It must be a direct connection, never the
PgBouncer pooler: the runner's lock against two people migrating at once is a
session lock, which transaction pooling doesn't keep. Your own `gcloud` login
reads the secret.

**What an admin sets up once.** In project `f3data`, secrets
`MIGRATE_DATABASE_URL_STAGING` and `MIGRATE_DATABASE_URL_PROD`, each the URL
of that database's `db_migrator` login (see [Database roles](#database-roles)),
and `roles/secretmanager.secretAccessor` on them for whoever runs migrations.
For unusual cases: `MIGRATE_SECRET` / `MIGRATE_SECRET_PROJECT` read a
different secret, and `MIGRATE_DATABASE_URL` supplies a URL directly; every
check still applies.

## Database roles

Migrations alter objects that today belong to several roles: on prod, the app
logins `app_auth`, `app_codex`, `app_materializedviewrefresher`, `f3slackbot`
and `tackle` (read-only check, 2026-10-08). List them for either database
with this read-only query:

```sql
SELECT pg_get_userbyid(o.owner) AS owner, o.kind, count(*)
FROM (
  SELECT c.relowner AS owner, c.oid, 'pg_class'::regclass AS cls,
    CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized view' ELSE 'table' END AS kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth', 'slackbot', 'drizzle')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  UNION ALL
  SELECT t.typowner, t.oid, 'pg_type'::regclass, 'type'
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('public', 'auth', 'slackbot', 'drizzle')
    AND t.typtype IN ('e', 'd', 'c', 'r', 'm') AND t.typrelid = 0
  UNION ALL
  SELECT p.proowner, p.oid, 'pg_proc'::regclass, 'function'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth', 'slackbot', 'drizzle')
  UNION ALL
  SELECT nspowner, oid, 'pg_namespace'::regclass, 'schema'
  FROM pg_namespace WHERE nspname IN ('public', 'auth', 'slackbot', 'drizzle')
) o
WHERE NOT EXISTS (SELECT 1 FROM pg_depend d   -- skip extension objects (citext)
  WHERE d.classid = o.cls AND d.objid = o.oid AND d.deptype = 'e')
GROUP BY 1, 2 ORDER BY 1, 2;
```

The migration commands check ownership by role membership
(`pg_has_role(current_user, owner, 'USAGE')`), so both phases below pass it
unchanged.

### Phase 1: a migration login (works today, nothing changes owner)

On each database, staging first, an admin creates one login that is a member
of every owner role the query lists, and may create schemas:

```sql
CREATE ROLE db_migrator LOGIN PASSWORD '<generated>';
GRANT app_auth, app_codex, app_materializedviewrefresher, f3slackbot, tackle
  TO db_migrator;                            -- every owner the query lists
GRANT CREATE ON DATABASE f3_staging TO db_migrator;   -- f3_prod on prod
```

Its URL (ending exactly in `/f3_staging` or `/f3_prod`) goes into
`MIGRATE_DATABASE_URL_STAGING` / `MIGRATE_DATABASE_URL_PROD`. If a migration
later creates objects owned by a new role, the command names the role it is
missing.

**New objects.** Whatever a migration creates is owned by the role it runs
as, here `db_migrator`, and the apps reach new objects only through that
role's default privileges: the migrations themselves grant nothing. Today
those defaults belong to the roles that have been running migrations (on
prod mostly `tackle` and `f3slackbot`; on staging `tackle` and
`dev_generic`). So before the first migration as `db_migrator`, give it the
same defaults, or new tables are invisible to the apps. List them:

```sql
SELECT pg_get_userbyid(defaclrole) AS creator,
  defaclnamespace::regnamespace AS schema, defaclobjtype AS kind, defaclacl
FROM pg_default_acl ORDER BY 1, 2, 3;
```

and repeat each one for `db_migrator`, e.g. for the auth app's tables:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE db_migrator IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_auth;
```

### Phase 2: one owner role (target state; its own PR/issue, staging first)

A `NOLOGIN` role `db_owner` owns every schema and object; `db_migrator`
inherits it (`GRANT db_owner TO db_migrator`) and stops needing the app
roles. Migrations then run as `db_owner` (`ALTER ROLE db_migrator SET role =
'db_owner'`), so what they create is owned by `db_owner` and gets
`db_owner`'s default privileges (step 2). Grant `db_owner` CREATE on the
database first (`GRANT CREATE ON DATABASE f3_staging TO db_owner`): after the
role switch, `db_migrator`'s own grant no longer applies, and the migrate
command refuses without it. The apps then use only granted
privileges. Before moving ownership:

1. **Grant each app login what it now gets from owning objects.** The
   slackbot connects as `f3slackbot`, which on prod owns about 35 tables,
   18 sequences and 2 views: without grants it loses access the moment they
   move. For each app login, grant DML on its tables (`SELECT, INSERT,
UPDATE, DELETE`), `USAGE, SELECT` on its sequences and `EXECUTE` on its
   functions. The materialized-view refresher needs `MAINTAIN` on the
   materialized views (Postgres 17+; prod runs 18) instead of ownership.
2. **Cover future objects:** `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner IN
SCHEMA …` granting the same to each app login, so objects later
   migrations create are usable without another grant.
3. **Move ownership object by object** (`ALTER TABLE … OWNER TO db_owner`,
   likewise for sequences, views, types, functions and schemas), generated
   from the query above. Not `REASSIGN OWNED`, which moves everything the role
   owns, wherever it is.
4. **Verify on staging** (api, map, slackbot, auth, the matview refresh),
   then repeat on prod.

## Deploying a batch of migrations

- **One transaction.** Drizzle applies all pending migrations, and their journal
  rows, in a single transaction. Postgres forbids using a value added by
  `ADD VALUE` before that transaction commits, so no migration in the same batch
  may reference the new value. Compare against `org_type::text` instead, or
  ship the use in a later release.
- **`CI` stops the local command.** `pnpm db:migrate:local` refuses when `CI`
  is set (it used to do nothing and still print `Migration done`). Unset it,
  or set it empty (`CI=`), to migrate a local database from a CI job.
- **Drizzle skips older migrations.** Drizzle (0.45) runs only migrations
  whose journal `when` is newer than the newest one already recorded in the
  database, and never looks at older ones again. So a migration a database is
  missing, older than one it has, is skipped forever, with no error. Example:
  a branch's migration is generated on Monday, and another branch's,
  generated on Tuesday, merges and is deployed first; Monday's never runs.
  `db:migrate:staging` / `db:migrate:prod` refuse when that would happen:
  regenerate the missing migration so its `when` is newer, and merge it again.
  A known historical exception, such as prod's `0008_nice_leech`, is listed
  explicitly in `packages/db/src/migrate-guards.ts`. Deleting a migration's
  journal row doesn't make Drizzle run it again either.
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
