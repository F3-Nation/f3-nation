---
applyTo: "packages/db/**,packages/db-python/**"
---

# Database: schema, migrations, seeds, DB tooling

Background: `docs/db-migrations.md`. Procedure:
`.agents/skills/db-migration/SKILL.md`. A human signs off on every schema
migration (`docs/AI_GUARDRAILS.md`).

## Migrations

- Each migration PR adds exactly the DDL for its own change.
  - Generate it from `schema.ts` with drizzle-kit; never hand-edit the
    snapshot.
  - Keep the SQL, `meta/NNNN_snapshot.json` and `meta/_journal.json` in
    lockstep.
  - Reject a migration that re-emits earlier DDL or drops an earlier
    migration's data-remap `UPDATE`: the snapshot chain is stale.
- After merging `main`, check the migration number is still free and the
  journal `when` is newer than every existing entry. Drizzle silently skips
  a migration whose `when` is not newer than the newest one already applied.
- Pending migrations run in **one transaction**:
  - No `CREATE INDEX CONCURRENTLY`.
  - A value added with `ALTER TYPE ... ADD VALUE` cannot be used by a later
    migration in the same batch.
  - One failing migration rolls back the rest.
- Prefer `ALTER TYPE ... ADD VALUE` to recreating an enum. If an enum or
  column type must be recreated:
  - Re-issue every function that references it.
  - Start with `SET LOCAL lock_timeout`.
  - Account for views that exist only in staging and prod; green CI proves
    nothing about them.
- Don't assume the migrating role owns the tables (prod and staging owners
  differ). `CREATE ... IF NOT EXISTS` does not verify an existing object's
  shape.
- `SECURITY DEFINER` functions: `SET search_path = pg_catalog, pg_temp`
  (plus the schema they write), schema-qualified names,
  `REVOKE EXECUTE ... FROM PUBLIC`.
- Trigger exceptions must not interpolate emails or other PII.
- New triggers on large tables must account for bulk loads (staging refresh,
  obfuscation).
- Large-table `ALTER`s take `ACCESS EXCLUSIVE` locks. The PR states the lock
  risk and the release steps (deploy order, manual grants).
- Migrations ship before, or together with, the code that reads them.
- Put integrity that matters in the database (CHECK, UNIQUE, FK
  `ON DELETE`), not only in the app write path. When adding an FK, check
  each child table's `ON DELETE`.
- `citext = text` compares case-sensitively. Compare like with like, or
  lower and trim on write.

## Schema conventions

- New timestamp columns in `public` and `slackbot` tables use
  `timestamp({ mode: "string" })`, matching their neighbours; don't flag a
  column for lacking `withTimezone`. The `auth`-schema Better Auth tables
  are the exception (`mode: "date"`, enforced by a test). Code reading a
  `mode: "string"` column must normalize the naive string to UTC before
  `new Date()`.
- A schema or enum change mirrored in
  `packages/db-python/f3_data_models/models.py` updates the Python model in
  the same PR (`test_enum_parity.py`).
- Per-region Slack settings live in `slack_spaces.settings`; ask before
  adding a table for them.
- Merge JSON blobs (`meta`, `settings`) in SQL (`jsonb ||`), not with a JS
  read-spread-write.

## Operator scripts and seeds

- Staging and prod are migrated only by `pnpm db:migrate:staging` /
  `db:migrate:prod`, from `main`. No plain `db:migrate` exists; never add a
  script or doc that runs Drizzle's migrator against a non-local URL.
- Destructive scripts (reset, restore, obfuscate, load snapshot) fail closed:
  - Check the **live** connection (`SELECT current_database()`) against an
    allowlist or disposable marker, not just the URL.
  - Never print DB URLs or row values.
  - Run every pre-flight check before the first write, and the destructive
    steps in one transaction.
- CLIs set `process.exitCode = 1` (or `process.exit(1)`) in the failure
  path. A `.catch` that only logs, followed by `process.exit()`, exits 0.
- Python pool size and timeout must be at least 1 (`0` means an unlimited
  pool / instant checkout failure); overflow may be 0. Size connection
  budgets as instances x (pool size + overflow).
- Changes to pool settings, timeouts or the connection path state the
  production evidence behind them, the metric to watch, and the rollback.
  Long-running CLIs opt out of query timeouts (`QUERY_TIMEOUT_MS=0`).
- Local seed API keys keep the `local-` prefix: the staging obfuscator's
  `--preserve-local-seed` spares only `local-*` keys.
- Seed lookups scope by parent (`parentId`, region); names are not unique.
  Seeds are idempotent.
- `reset()` must also drop any schema a migration adds.
