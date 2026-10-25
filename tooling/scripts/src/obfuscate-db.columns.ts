/**
 * Column-level review gate for obfuscate-db.ts (F3-65).
 *
 * assertFullCoverage refuses a table the script has never classified, but a
 * new COLUMN on a known table would be copied to staging as-is: the per-table
 * jobs only touch the columns they name. So every column the script has been
 * reviewed against is listed in obfuscate-db.columns.txt
 * (`schema.table.column:data_type`, data_type as information_schema.columns
 * reports it), and the obfuscator refuses, before it writes anything, when
 * the target has a column or a column type that isn't listed.
 *
 * The human review moves to the pull request: a migration that adds a column
 * has to add its line here too (CI's obfuscate-db-verify migrates a sandbox
 * to head and fails otherwise), and the reviewer checks that the column is
 * classified in obfuscate-db.ts and docs/STAGING_REFRESH.md.
 *
 * Regenerate after a migration (DATABASE_URL = a database migrated to head):
 *   pnpm -F @acme/scripts obfuscate-db -- --print-columns
 *   pnpm -F @acme/scripts obfuscate-db -- --update-column-snapshot
 * The update only ADDS lines: the snapshot also holds prod-only legacy tables
 * (auth.user, …) that no migration creates, so it is a superset of any one
 * database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type postgres from "postgres";

export const COLUMN_SNAPSHOT_PATH = fileURLToPath(
  new URL("./obfuscate-db.columns.txt", import.meta.url),
);

// Every table, partitioned table and materialized view in every non-system
// schema is in scope (the slackbot schema arrived with F3versary in
// migration 0028 and was caught this way). Excluded: drizzle's migration
// bookkeeping and the refresh_keep* holding schemas that staging-api-keys.ts
// / staging-slack.ts create on staging (the verify harness plays staging too,
// so they exist there during the run).
export const COVERAGE_EXCLUDED_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "drizzle",
  "refresh_keep",
  "refresh_keep_slack",
];

function splitSnapshot(text: string): { header: string[]; entries: string[] } {
  const lines = text.split("\n");
  const header = lines.filter((l) => l.startsWith("#"));
  const entries = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return { header, entries };
}

export function readColumnSnapshot(file = COLUMN_SNAPSHOT_PATH): Set<string> {
  return new Set(splitSnapshot(readFileSync(file, "utf8")).entries);
}

/** Every column in scope, as sorted `schema.table.column:data_type` lines. */
export async function readTargetColumns(sql: postgres.Sql): Promise<string[]> {
  // pg_attribute, not information_schema alone: information_schema hides
  // columns the current role has no privilege on, and a hidden column must
  // fail the gate, not slip past it. Such a column (and any materialized
  // view column, which information_schema doesn't list) falls back to
  // format_type, which won't match a snapshot line unless it was reviewed in
  // that form.
  const rows = await sql<{ entry: string }[]>`
    SELECT n.nspname || '.' || c.relname || '.' || a.attname || ':' ||
      coalesce(ic.data_type, format_type(a.atttypid, a.atttypmod)) AS entry
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN information_schema.columns ic
      ON ic.table_schema = n.nspname AND ic.table_name = c.relname
      AND ic.column_name = a.attname
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p', 'm') AND NOT c.relispartition
      AND n.nspname <> ALL(${COVERAGE_EXCLUDED_SCHEMAS})
      AND left(n.nspname, 3) <> 'pg_'`;
  return rows.map((r) => r.entry).sort();
}

/** Target columns (with their type) that nobody has reviewed. */
export function unreviewedColumns(
  target: string[],
  snapshot: Set<string>,
): string[] {
  return target.filter((entry) => !snapshot.has(entry));
}

/** Add `entries` to the snapshot file; returns the lines that were new. */
export function addToColumnSnapshot(
  entries: string[],
  file = COLUMN_SNAPSHOT_PATH,
): string[] {
  const { header, entries: existing } = splitSnapshot(
    readFileSync(file, "utf8"),
  );
  const known = new Set(existing);
  const added = entries.filter((e) => !known.has(e));
  const merged = [...new Set([...existing, ...added])].sort();
  writeFileSync(file, [...header, ...merged, ""].join("\n"));
  return added;
}
