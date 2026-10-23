---
name: db-migration
description: Plan, generate, check and hand off a Postgres schema change in packages/db (Drizzle). Use when a change edits packages/db/drizzle/schema.ts or packages/shared/src/app/enums.ts, adds or renumbers a migration, or someone asks to "add a migration", "change the schema", "add a column/table/enum value", or "fix a migration conflict".
---

# Database migration

One migration, containing only its own change, safe to apply in production,
with everything that depends on it. Read
[`docs/db-migrations.md`](../../../docs/db-migrations.md) for the why. This
file is the order of work.

A human signs off on every schema migration
([`docs/AI_GUARDRAILS.md`](../../../docs/AI_GUARDRAILS.md)). An agent never
runs `db:migrate:staging` or `db:migrate:prod`; people run them from `main`
after merge, through the release plan.

## 1. Choose the shape

- Prefer additive: a nullable column, a new table, or
  `ALTER TYPE … ADD VALUE … BEFORE|AFTER`.
- Split a rename or drop into expand, migrate data, contract, across
  releases, so running code keeps working.
- Recreating an enum or changing a column type needs the dependency check
  in step 4 and a maintenance window. Tell the human before writing it.
- All pending migrations apply in **one transaction**:
  - No `CREATE INDEX CONCURRENTLY`.
  - No use of an `ADD VALUE` value in the same batch. Compare against
    `::text`, or ship the use later.

## 2. Start from current `main`

```bash
git fetch <remote-for-F3-Nation/f3-nation> && git merge <remote>/main
ls packages/db/drizzle/*.sql | tail -3        # highest number on main
gh pr list --repo F3-Nation/f3-nation --state open --limit 100 \
  --json number,title,headRefName,files \
  --jq '.[] | select(any(.files[]?; .path | startswith("packages/db/drizzle/"))) | "\(.number) \(.headRefName)"'
```

If an open PR uses the next number, agree the merge order now. A collision
found after merge means renumbering a migration that a database may have
already run.

## 3. Generate

1. Edit `packages/db/drizzle/schema.ts`; enum values live in
   `packages/shared/src/app/enums.ts`.
2. `pnpm -F db generate --name=<snake_case_summary>`. Answer drizzle-kit's
   rename-or-create prompts in a real terminal; CI can't, and
   `db-schema-sync` fails.
3. Data backfills, functions, triggers: `pnpm -F db generate:empty
--name=<…>`, then write the SQL.
4. Never hand-edit `meta/*_snapshot.json`; touch `meta/_journal.json` only by
   regenerating (step 7).

## 4. Read the generated SQL

Reject and regenerate if any of these fail:

- [ ] Only this change. Re-emitted earlier DDL (enum rebuilds, an existing
      `ADD COLUMN`) or a dropped data `UPDATE` means a stale snapshot chain.
- [ ] Large or hot tables (e.g. `users`, `attendance`, `event_instances`,
      `orgs`) start with `SET LOCAL lock_timeout` (see 0026), and the PR
      states the lock risk.
- [ ] Doesn't assume the migrating login owns the tables
      (§ Database roles in the doc).
- [ ] `SECURITY DEFINER` functions: `SET search_path = pg_catalog, pg_temp`
      (plus any schema they write), schema-qualified names,
      `REVOKE EXECUTE … FROM PUBLIC`. Trigger messages carry no emails or
      other PII.
- [ ] New FKs: each child table's `ON DELETE` is deliberate. Integrity that
      matters is a constraint, not app code.
- [ ] Triggers on large tables: staging refresh and the obfuscator bulk-load
      around them.
- [ ] Enum recreation or column type change: run the dependency query from
      § Views created outside the migrations against staging and prod
      (read-only; ask a human without access). Re-issue every function that
      references the type.

## 5. Move what depends on the schema

- [ ] Enums: `packages/db-python/f3_data_models/models.py` mirrors them
      (`test_enum_parity.py`). Columns and tables too, if that table is
      already mirrored there.
- [ ] New table: classify it in `TOUCHED_TABLES`/`KEPT_TABLES` in
      `tooling/scripts/src/obfuscate-db.ts`. New column or changed column
      type: classify it there and in `docs/STAGING_REFRESH.md`, then add its
      line to `tooling/scripts/src/obfuscate-db.columns.txt` (with `DATABASE_URL`
      at a migrated DB:
      `pnpm -F @acme/scripts obfuscate-db -- --update-column-snapshot`).
      This is PII review; CI's `obfuscate-db-verify` fails otherwise.
- [ ] Local seed (`packages/db/src/local-seed-lib/`) still loads.
      `packages/db/src/reset.ts` drops a fixed list of schemas: add any new
      schema there.
- [ ] API: routers returning the table get `.output()` changes. If
      `apps/api/characterization/__snapshots__/openapi.golden.json` changes,
      that is a deliberate behaviour change: update it and call it out in the PR
      (`docs/testing.md`, "Golden files are frozen").
- [ ] The feature spec in `docs/specs/` and any doc naming the table, enum or
      column (`git grep -n '<name>' -- docs '*.md'`).

## 6. Prove it locally

```bash
pnpm db:migrate:local          # existing local DB, upgraded in place
pnpm reset-test-db             # needs TEST_DATABASE_URL (a *_test DB), else it silently skips
pnpm -F db generate            # must print no changes (what CI's db-schema-sync checks)
pnpm -F db test && pnpm -F @acme/api test
pnpm -F f3-data-models test    # if models.py changed; needs uv
```

For anything destructive, rehearse the rollback SQL on a local copy and put
it in the PR.

## 7. Before merge, re-check ordering

Merge `main` again just before merge. If `main` gained a migration since you
generated yours:

1. Save your custom SQL. Remove your `.sql`, its `meta/NNNN_snapshot.json`
   and its `_journal.json` entry, then restore main's copies of the shared
   files: `git checkout <remote>/main -- packages/db/drizzle`. If you already
   merged, `NNNN_snapshot.json` may be main's file: don't delete it.
2. `pnpm -F db generate --name=<…>` (or `generate:empty` and paste the SQL).
   drizzle-kit takes the next index after the last journal entry and sets
   `when` to now.
3. `pnpm -F db with-env drizzle-kit check` warns if a `when` isn't strictly
   increasing or snapshots collide.

Your `when` must be newer than every other entry; Drizzle silently skips older
ones forever. Never delete or edit a journal row any database has applied.

## 8. PR body

Add a **Migration** section:

- The migration file and what it changes, one line each.
- Lock and size risk; whether it needs a maintenance window.
- Release steps: order relative to the app deploy (the migration lands before
  code that reads it), manual grants or default privileges, staging-refresh
  impact.
- Rollback SQL, or "forward-fix only" with the reason.
- Prod-only object check result (step 4), when it applied.
- Any `openapi.golden.json` change (step 5).
- A line saying a human must sign off before merge.

Sign the PR body `_written by <model>_` (see the `github` skill).
