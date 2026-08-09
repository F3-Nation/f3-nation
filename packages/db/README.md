# @acme/db

Shared database package for the F3 Nation monorepo. Provides the Drizzle ORM
schema, a lazy-initialized database client, migration tooling, and seeding
utilities consumed by all apps that talk to Postgres.

## Contents

- [Connection & client](#connection--client)
- [Scripts](#scripts)
- [Migrations](#migrations)
- [Seeding](#seeding)
- [Audit history](#audit-history)

---

## Connection & client

**`src/client.ts`** exports a single lazy `db` instance and the `AppDb` type:

```ts
import { db } from "@acme/db/client";
import type { AppDb } from "@acme/db/client";
```

The client is a `Proxy` that defers the real Postgres connection until the first
property access. This lets apps import `@acme/db` during `next build` without
`DATABASE_URL` being set at build time.

SSL is **disabled** so PgBouncer can operate in transaction-pooling mode. Do not
re-enable it without auditing all transaction-scoped `SET LOCAL` calls.

In non-production environments the connection is cached in `global.db` to
prevent hot-reload from exhausting the connection pool. In production a fresh
connection is created per import.

**`DATABASE_URL`** is used for the application database; **`TEST_DATABASE_URL`**
is used when `NODE_ENV === "test"`.

---

## Scripts

Run from the repo root with `pnpm -C packages/db <script>` or via the root
turbo pipeline.

| Script           | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `generate`       | Generate a new Drizzle migration from schema changes             |
| `generate:empty` | Generate an empty custom migration file (`--custom`)             |
| `migrate`        | Apply pending migrations to `DATABASE_URL`                       |
| `push`           | Push schema directly to the DB (dev shortcut, no migration file) |
| `pull`           | Introspect the live DB and update the schema file                |
| `reset`          | Drop all tables and re-run migrations + seed                     |
| `seed`           | Run the production seed against `DATABASE_URL`                   |
| `seed:local`     | Run the local-dev seed (richer fixture data)                     |
| `reset-test-db`  | Drop, re-migrate, and seed `TEST_DATABASE_URL`                   |
| `studio`         | Open Drizzle Studio UI                                           |
| `drop`           | Drop a specific migration file                                   |

All scripts that hit the database load credentials from `packages/db/.env`
(copied from `packages/db/.env.example` by `pnpm local:setup`).

---

## Migrations

Migrations live in `drizzle/` as numbered SQL files
(`0000_*.sql`, `0001_*.sql`, etc.). The journal at `drizzle/meta/_journal.json`
tracks which files have been applied.

**Generating a schema migration:**

```bash
pnpm -C packages/db generate
```

Drizzle Kit compares `drizzle/schema.ts` against the latest snapshot and writes
a new numbered `.sql` file.

**Generating an empty custom migration** (for raw SQL that Drizzle cannot
generate automatically):

```bash
pnpm -C packages/db generate:empty
```

Edit the generated file below the `-- Custom SQL migration file` marker, then
run `pnpm -C packages/db migrate`.

**Applying migrations:**

```bash
pnpm -C packages/db migrate
```

The runner skips execution in CI (`process.env.CI`). Migrations are applied
out-of-band via deploy scripts or local `pnpm db:migrate` from the repo root.

---

## Seeding

| File                  | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `src/seed.ts`         | Entry point for production / staging seed                   |
| `src/seed/core.ts`    | Core seed logic (org hierarchy, event types, etc.)          |
| `src/local-seed.ts`   | Entry point for local-dev seed                              |
| `src/local-seed-lib/` | Fixtures for local dev (orgs, users, events, attendance, …) |
| `src/test-seed.ts`    | Minimal seed applied after `reset-test-db`                  |

The test seed creates the minimum data needed by the integration test suite
(a Nation org, a set of roles, one admin user). Individual router tests then
create their own fixtures and clean up in `afterAll`.

---

## Audit history

The audit system records every INSERT, UPDATE, and DELETE on tracked tables
into **sister schemas** — `public_history`, `auth_history`, and so on. Each
sister schema mirrors the name structure of its source schema; history tables
inside it have the same names as the source tables.

```text
public.orgs        → public_history.orgs
auth.oauth_clients → auth_history.oauth_clients
```

This preserves schema-level access control: granting read access to
`public_history` is independent of granting access to `auth_history`.

### Helper functions (in the `audit` schema)

| Function                                                  | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `audit.enable_tracking(target, ignore_cols, redact_cols)` | Create the history table + indexes and attach the trigger    |
| `audit.disable_tracking(target)`                          | Drop the trigger; history data is preserved                  |
| `audit.log_change()`                                      | Generic AFTER trigger function called by every tracked table |

### History table shape

Every history table has the same columns regardless of which source table it
mirrors:

| Column        | Type        | Description                                                                          |
| ------------- | ----------- | ------------------------------------------------------------------------------------ |
| `id`          | bigserial   | History-row primary key                                                              |
| `row_id`      | text        | PK of the changed row, colon-joined for composite PKs                                |
| `op`          | char(1)     | `I` (insert), `U` (update), `D` (delete)                                             |
| `changed_at`  | timestamptz | When the change was committed                                                        |
| `changed_by`  | integer     | `users.id` of the acting user; `NULL` for seeds, migrations, and bot writes          |
| `changed_via` | text        | Originating app (`f3-map`, `f3-admin`, `f3-me`, `f3-slackbot`, …); `NULL` when unset |
| `old_row`     | jsonb       | Full row before the change; `NULL` on INSERT                                         |
| `new_row`     | jsonb       | Full row after the change; `NULL` on DELETE                                          |

Table carries no foreign-key constraint so history survives source deletion.

### No-op suppression

An UPDATE that changes only bookkeeping columns produces no history row.
`ignore_cols` lists the columns to exclude from the comparison — pass the
table's own timestamp column name (`updated`, `updated_at`, `"updatedAt"`, etc.)
plus any derived columns that change as a side-effect of other triggers (e.g.
`ao_count` on `orgs`). There is no default; every `enable_tracking` call must
be explicit.

### Column redaction

Columns listed in `redact_cols` are never stored verbatim. Instead, their
value is replaced with a sentinel string before the history row is written:

- `"[redacted]"` — column value is present but not stored.
- `"[redacted: changed]"` — column value changed (visible only in `new_row`).

This means credential rotation events are recorded without storing the
credential itself.

### Tracked tables

To query which tables are actively tracked at runtime:

```sql
SELECT nspname AS schema, relname AS table
FROM pg_trigger
JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE tgname LIKE 'zz_audit_%'
ORDER BY nspname, relname;
```

### Auditing a new table

Add one line to a new custom migration:

```sql
-- Most tables — pass the table's timestamp column name
SELECT audit.enable_tracking('public.my_table'::regclass, ARRAY['updated']);

-- Extra ignore_cols (suppress no-op rows when a derived column changes)
SELECT audit.enable_tracking('public.my_table'::regclass,
  ARRAY['updated', 'computed_count']
);

-- redact_cols only (no timestamp column to suppress)
SELECT audit.enable_tracking('public.my_table'::regclass,
  ARRAY[]::text[],
  ARRAY['token_hash']
);

-- Both
SELECT audit.enable_tracking('public.my_table'::regclass,
  ARRAY['updated'],            -- ignore_cols
  ARRAY['token_hash']          -- redact_cols
);
```

To stop tracking without losing history:

```sql
SELECT audit.disable_tracking('public.my_table'::regclass);
```

### Querying history

```sql
-- Most recent changes to org id 42
SELECT op, changed_at, changed_by, changed_via, old_row, new_row
FROM public_history.orgs
WHERE row_id = '42'
ORDER BY changed_at DESC;

-- All credential rotations for oauth_clients
SELECT op, changed_at, changed_by, new_row->>'client_id'
FROM auth_history.oauth_clients
WHERE new_row->>'client_secret_hash' = '[redacted: changed]'
ORDER BY changed_at DESC;
```
