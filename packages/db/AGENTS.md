# packages/db

Schema, migrations, seeds and DB tooling. Background:
[`docs/db-migrations.md`](../../docs/db-migrations.md). Step-by-step procedure:
the [`db-migration`](../../.agents/skills/db-migration/SKILL.md) skill. A human
signs off on every schema migration (`docs/AI_GUARDRAILS.md`).

## Migrations

- A migration PR adds only the SQL for its own change, including any
  backfill, function or trigger it needs. Generate it from
  `drizzle/schema.ts` with drizzle-kit, never hand-edit the snapshot, and keep
  the SQL, `meta/NNNN_snapshot.json` and `meta/_journal.json` in lockstep. A
  migration that re-emits earlier DDL, or drops an earlier migration's
  data-remap `UPDATE`, means the snapshot chain is stale.
- After merging `main`, check the migration number is still free and the
  journal `when` is newer than every existing entry. Drizzle silently skips a
  migration whose `when` isn't newer than the newest one already applied.
- Pending migrations run in **one transaction**: no
  `CREATE INDEX CONCURRENTLY`, a value added with `ALTER TYPE … ADD VALUE`
  can't be used by a later migration in the same batch, and one failure rolls
  back the rest.
- Prefer `ALTER TYPE … ADD VALUE` to recreating an enum. If an enum or column
  type must be recreated, re-issue every function that references it, start
  with `SET LOCAL lock_timeout`, and account for views that exist only in
  staging and prod (green CI proves nothing about them).
- Don't assume the migrating role owns the tables; prod and staging owners
  differ. `CREATE … IF NOT EXISTS` doesn't verify an existing object's shape.
- `SECURITY DEFINER` functions set `search_path = pg_catalog, pg_temp` (plus
  the schema they write), use schema-qualified names, and
  `REVOKE EXECUTE … FROM PUBLIC`. Trigger exceptions never interpolate emails
  or other PII.
- New triggers on large tables account for bulk loads (staging refresh,
  obfuscation).
- Large-table `ALTER`s take `ACCESS EXCLUSIVE` locks; the PR states the lock
  risk and the release steps (deploy order, manual grants). Migrations ship
  before, or together with, the code that reads them.
- Put integrity that matters in the database (CHECK, UNIQUE, FK
  `ON DELETE`), not only in the app write path; when adding an FK, check each
  child table's `ON DELETE`.
- `citext = text` compares case-sensitively. Compare like with like, or lower
  and trim on write.

## Schema conventions

- Timestamp columns in `public` tables use `timestamp({ mode: "string" })`
  without `withTimezone`, matching their neighbours; `slackbot` schema tables
  use `{ withTimezone: true, mode: "string" }`. The Better Auth tables in the
  `auth` schema use `mode: "date"` (enforced by a test). Code reading a naive
  `mode: "string"` column normalizes it to UTC before `new Date()`.
- A schema or enum change mirrored in
  `packages/db-python/f3_data_models/models.py` updates the Python model in
  the same PR (`test_enum_parity.py`).
- Per-region Slack settings live in `slack_spaces.settings`; ask before adding
  a table for them.
- Merge JSON blobs (`meta`, `settings`) in SQL (`jsonb ||`), not with a JS
  read-spread-write.
- A user with no role is a normal user by design; seeds don't create a
  `user` role.

## Operator scripts and seeds

- Staging and prod are migrated only by `pnpm db:migrate:staging` /
  `pnpm db:migrate:prod`, from `main`. There is no plain `db:migrate`; never
  add a script or doc that runs Drizzle's migrator against a non-local URL.
- Destructive scripts (reset, restore, obfuscate, load snapshot) fail closed:
  check the **live** connection (`SELECT current_database()`) against an
  allowlist or disposable marker, never print DB URLs or row values, run every
  pre-flight check before the first write, and run the destructive steps in
  one transaction.
- CLIs set `process.exitCode = 1` (or call `process.exit(1)`) on failure. A
  `.catch` that only logs, followed by `process.exit()`, exits 0.
- Python pool size and timeout are at least 1 (`0` means an unlimited pool or
  instant checkout failure); overflow may be 0. Size connection budgets as
  instances × (pool size + overflow).
- Changes to pool settings, timeouts or the connection path state the
  production evidence behind them, the metric to watch, and the rollback.
  Long-running CLIs opt out of query timeouts (`QUERY_TIMEOUT_MS=0`).
- Local seed API keys keep the `local-` prefix: the staging obfuscator's
  `--preserve-local-seed` spares only `local-*` keys.
- Seed lookups scope by parent (`parentId`, region) because names aren't
  unique, and seeds are idempotent.
- `reset()` drops a fixed list of schemas; add any schema a migration
  creates.
