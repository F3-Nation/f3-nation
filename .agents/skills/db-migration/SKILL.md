---
name: db-migration
description: Plan, generate, check and hand off a Postgres schema change in packages/db (Drizzle). Use when a change edits packages/db/drizzle/schema.ts or packages/shared/src/app/enums.ts, adds or renumbers a migration, or someone asks to "add a migration", "change the schema", "add a column/table/enum value", or "fix a migration conflict".
---

# Database migration

This skill produces one migration that contains only its own change, is
safe to apply in production, and comes with everything that has to move
with it. Read
[`docs/db-migrations.md`](../../../docs/db-migrations.md) for the why. This
file is the order of work.

A human signs off on every schema migration
([`docs/AI_GUARDRAILS.md`](../../../docs/AI_GUARDRAILS.md)). An agent never
runs `db:migrate:staging` or `db:migrate:prod`. People do that from `main`
after merge, through the release plan.

## 1. Choose the shape

- Prefer additive changes: a new nullable column, a new table, or
  `ALTER TYPE … ADD VALUE … BEFORE|AFTER`.
- Split a rename or drop into expand → migrate data → contract, across
  releases, so the code that is running keeps working.
- Recreating an enum, or changing a column type, needs the dependency check
  in step 4 and a maintenance window. Say so to the human before you write
  it.
- Everything pending is applied in **one transaction**:
  - No `CREATE INDEX CONCURRENTLY`.
  - No use of a value added with `ADD VALUE` in the same release.
  - Compare against `::text`, or ship the use later.

## 2. Start from current `main`

```bash
git fetch origin && git merge origin/main     # or rebase
ls packages/db/drizzle/*.sql | tail -3        # highest number on main
gh pr list --repo F3-Nation/f3-nation --state open --search "packages/db/drizzle in:files" \
  --json number,title,headRefName
```

If an open PR already uses the next number, coordinate the merge order now.
A collision found after merge means a manual renumber against a database
that may already have run the migration.

## 3. Generate

1. Edit `packages/db/drizzle/schema.ts`. Enum values are declared in
   `packages/shared/src/app/enums.ts`.
2. `pnpm -F db generate`. Answer drizzle-kit's rename-or-create prompts in a
   real terminal, because CI can't answer them (`db-schema-sync` fails).
3. For data backfills, functions or triggers, add a custom migration with
   `pnpm -F db generate:empty` and write the SQL there.
4. Never hand-edit `meta/*_snapshot.json`. Edit `meta/_journal.json` only by
   regenerating (see step 7).

## 4. Read the generated SQL

Reject and regenerate if any of these fail:

- [ ] It contains only this change. Re-emitted DDL from earlier migrations
      (enum rebuilds, `ADD COLUMN` that already exists), or a dropped data
      `UPDATE`, means the snapshot chain is stale.
- [ ] Hot or large tables (`users`, `attendance`, `event_instances`,
      `orgs`, `roles`…) start with `SET LOCAL lock_timeout`, and the PR
      states the lock risk.
- [ ] No assumption that the migrating login owns the tables, and no
      `ALTER … OWNER`. See § Database roles in the doc.
- [ ] `SECURITY DEFINER` functions have
      `SET search_path = pg_catalog, pg_temp`, schema-qualified names and
      `REVOKE EXECUTE … FROM PUBLIC`. Trigger messages never include emails
      or other PII.
- [ ] New FKs: check each child table's `ON DELETE`. Integrity that matters
      is a constraint, not app code.
- [ ] Triggers on large tables: decide how staging refresh and the
      obfuscator bulk-load around them.
- [ ] Enum recreation or a column type change: run the dependency query from
      § Views created outside the migrations against staging and prod
      (read-only; ask a human if you have no access). Re-issue every function
      that references the type.

## 5. Move everything that depends on the schema

- [ ] `packages/db-python/f3_data_models/models.py` mirrors new enums,
      columns and tables; `test_enum_parity.py` passes.
- [ ] New columns: add the line to `tooling/scripts/src/obfuscate-db.columns.txt`
      and classify it in `obfuscate-db.ts` and `docs/STAGING_REFRESH.md`.
      This is PII review; CI's obfuscate-db verify fails otherwise.
- [ ] Local seed (`packages/db/src/local-seed-lib/`) still loads.
      `reset.ts` drops any new schema.
- [ ] API: routers that return the table get `.output()` field changes, and
      `apps/api/characterization/__snapshots__/openapi.golden.json` is
      regenerated.
- [ ] The feature spec in `docs/specs/` and any doc that names the
      table, enum or column (`git grep -n '<name>' -- docs '*.md'`).

## 6. Prove it locally

```bash
pnpm db:migrate:local          # existing local DB, upgraded in place
pnpm reset-test-db             # fresh DB from all migrations
pnpm -F db generate            # must print no changes: what CI's db-schema-sync checks
pnpm -F db test && pnpm -F @acme/api test
pnpm -F f3-data-models test     # if the Python models changed
```

For anything destructive, rehearse the rollback SQL against a local copy, and
put it in the PR.

## 7. Before merge, re-check ordering

Merge `main` again just before merge. If `main` gained a migration since you
generated yours:

1. Delete your `.sql`, its `meta/NNNN_snapshot.json` and its
   `_journal.json` entry. Keep your custom SQL somewhere first.
2. `pnpm -F db generate` (or `generate:empty` and paste the SQL back).

Your migration's journal `when` must be newer than every other entry.
Drizzle silently skips older ones forever. Never delete or edit a journal
row that any database has applied.

## 8. PR body

Add a **Migration** section:

- The migration file and what it changes, in one line each.
- Lock and size risk, and whether it needs a maintenance window.
- Release steps:
  - The order relative to the app deploy (the migration must land before code
    that reads it).
  - Manual grants or default privileges.
  - Staging-refresh impact.
- Rollback SQL, or "forward-fix only" with the reason.
- Prod-only object check result (step 4), when it applied.
- A line saying a human must sign off before merge.

Sign the PR body `_written by <model>_` (see the `github` skill).
