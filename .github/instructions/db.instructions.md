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
  - Reject a migration that re-emits earlier DDL, or drops an earlier
    migration's data-remap `UPDATE`. This is a sign of a stale snapshot chain.
- After merging `main`, check that the migration number is still free and
  that the journal `when` is later than every existing entry. Drizzle silently
  skips a migration whose `when` is not the newest.
- The migrator applies all pending migrations in **one transaction**:
  - No `CREATE INDEX CONCURRENTLY`.
  - A value added with `ALTER TYPE … ADD VALUE` cannot be used in the same
    deploy.
  - One failing migration rolls back the others.
- Prefer `ALTER TYPE … ADD VALUE` to recreating an enum. If an enum or column
  type must be recreated:
  - Re-issue every function that references it.
  - Set `SET LOCAL lock_timeout` first.
  - Account for views that exist only in staging and prod. Green CI proves
    nothing about them.
- Do not assume `current_user` owns the tables; prod and staging owners
  differ from the migrating role. `CREATE … IF NOT EXISTS` does not verify an
  existing object's shape.
- `SECURITY DEFINER` functions:
  - `SET search_path = pg_catalog, pg_temp` (plus the schema they write).
  - Use schema-qualified names.
  - `REVOKE EXECUTE … FROM PUBLIC`.
- Trigger exceptions must not interpolate emails or other PII.
- New triggers on large tables must account for bulk loads (staging refresh,
  obfuscation).
- Large-table `ALTER`s take `ACCESS EXCLUSIVE` locks. The PR states the lock
  risk and the release steps (deploy order, manual grants).
- Migrations ship before, or together with, the code that reads them.
- Integrity that matters goes in the database (CHECK, UNIQUE, FK
  `ON DELETE`), not only in the single app write path. When adding an FK,
  check each child table's `ON DELETE`.
- Compare `citext` against `text` explicitly (lower + trim on write).

## Schema conventions

- Timestamps use the schema-wide `timestamp({ mode: "string" })`. Do not flag
  a single new column for lacking `withTimezone`. Code reading these columns
  must normalize to UTC before calling `new Date()`.
- A schema or enum change mirrored in
  `packages/db-python/f3_data_models/models.py` updates the Python model in the
  same PR (`test_enum_parity.py`).
- Per-region Slack settings live in `slack_spaces.settings` JSON. Ask before
  adding a table for them.
- JSON blobs (`meta`, `settings`) are merged in SQL (`jsonb ||`), not with a
  JS read-spread-write.
- Explain any index that looks redundant with a comment naming the query it
  serves.

## Operator scripts and seeds

- Run staging and prod migrations only with `pnpm db:migrate:staging` /
  `db:migrate:prod`. Never document or script `db:migrate` against a non-local
  URL.
- Destructive scripts (reset, restore, obfuscate, load snapshot) fail closed:
  - Verify the **live** connection (`SELECT current_database()`) against an
    allowlist.
  - Never print DB URLs or row values.
  - Keep every check that can fail inside the rollback boundary.
- CLIs exit non-zero on failure (`process.exitCode = 1`). Never
  `.finally(() => process.exit())` after a caught error.
- Python pool settings reject `0` for size and timeout. Size connection
  budgets as instances × pool max, including overflow.
- Changes to pool settings, timeouts or the connection path state the
  production evidence they're based on, the metric to watch, and the
  rollback. Long-running CLIs opt out of query timeouts.
- Local seed API keys and users use the `local-` prefix. The obfuscator
  deletes everything else.
- Seed lookups scope by parent (`parentId`, region); names are not unique.
  Seeds are idempotent.
- `reset()` must also drop any schema a migration adds.
