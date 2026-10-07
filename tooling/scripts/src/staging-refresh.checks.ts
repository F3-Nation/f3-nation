/**
 * Pure decision logic for staging-refresh.ts (no I/O), so the gates can be
 * exercised on their own.
 */

/** A row of drizzle.__drizzle_migrations_<db>. */
export interface AppliedMigration {
  createdAt: number;
  hash: string;
}

/** An entry of packages/db/drizzle/meta/_journal.json. */
export interface JournalEntry {
  when: number;
  tag: string;
}

export interface GateResult {
  errors: string[];
  warnings: string[];
}

/**
 * Prod and staging must be at the same migration level, and prod (so the
 * copy) must not be ahead of the repo this refresh was built from.
 *
 * "Level" is drizzle's own notion: the newest applied `created_at`. The
 * migrator only applies journal entries newer than that, so two databases
 * with the same newest entry get the same migrations next. Older
 * differences (a migration one side skipped, a hash that changed because the
 * file was edited after it ran) are real on prod and staging today; they are
 * reported, and the per-table column check before the load is what stops a
 * structural difference.
 */
export function migrationGate(
  prod: AppliedMigration[],
  staging: AppliedMigration[],
  journal: JournalEntry[],
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tagOf = new Map(journal.map((j) => [j.when, j.tag]));
  const name = (createdAt: number) =>
    tagOf.get(createdAt) ?? `unknown migration (created_at ${createdAt})`;
  const level = (rows: AppliedMigration[]) =>
    rows.reduce((max, r) => Math.max(max, r.createdAt), 0);

  if (prod.length === 0) errors.push("prod has no applied migrations");
  if (staging.length === 0) errors.push("staging has no applied migrations");
  if (errors.length > 0) return { errors, warnings };

  const prodLevel = level(prod);
  const stagingLevel = level(staging);
  if (prodLevel !== stagingLevel) {
    errors.push(
      `prod is at ${name(prodLevel)} but staging is at ${name(stagingLevel)}. ` +
        `The refresh loads data only, into staging's existing tables, so both must be at ` +
        `the same migration level. Refresh right after a prod release, once ` +
        `staging and prod run the same migrations.`,
    );
  }

  const unknown = prod.filter((r) => !tagOf.has(r.createdAt));
  if (unknown.length > 0) {
    errors.push(
      `prod has ${unknown.length} migration(s) this build's packages/db/drizzle/meta/_journal.json ` +
        `doesn't know (${unknown.map((r) => r.createdAt).join(", ")}): the copy would be ahead of the ` +
        `code that classifies it. Rebuild the refresh image from current main ` +
        `(tooling/scripts/staging-refresh/setup.sh) and run again.`,
    );
  }

  const prodSet = new Set(prod.map((r) => r.createdAt));
  const stagingSet = new Set(staging.map((r) => r.createdAt));
  const onlyProd = [...prodSet].filter((c) => !stagingSet.has(c));
  const onlyStaging = [...stagingSet].filter((c) => !prodSet.has(c));
  if (onlyProd.length > 0) {
    warnings.push(
      `applied on prod but not staging: ${onlyProd.map(name).join(", ")}`,
    );
  }
  if (onlyStaging.length > 0) {
    warnings.push(
      `applied on staging but not prod: ${onlyStaging.map(name).join(", ")}`,
    );
  }
  const stagingHash = new Map(staging.map((r) => [r.createdAt, r.hash]));
  const rehashed = prod.filter((r) => {
    const other = stagingHash.get(r.createdAt);
    return other !== undefined && other !== r.hash;
  });
  if (rehashed.length > 0) {
    warnings.push(
      `same migration, different file hash on prod and staging (edited after it ran): ` +
        rehashed.map((r) => name(r.createdAt)).join(", "),
    );
  }
  return { errors, warnings };
}

/** table ("schema.table") -> column -> type */
export type TableColumns = Map<string, Map<string, string>>;

export interface LoadPlan {
  load: string[];
  copyOnly: string[];
  stagingOnly: string[];
  preserved: string[];
  mismatches: string[];
}

/**
 * Tables present in both the obfuscated copy and staging are loaded, except
 * the preserved ones. Each loaded table must have the same columns (name and
 * type) on both sides; anything else is a mismatch that stops the refresh
 * before staging is touched.
 */
export function planLoad(
  copy: TableColumns,
  staging: TableColumns,
  preserved: string[],
): LoadPlan {
  const keep = new Set(preserved);
  const both = [...copy.keys()].filter((t) => staging.has(t)).sort();
  const load = both.filter((t) => !keep.has(t));
  const mismatches: string[] = [];
  for (const table of load) {
    const a = copy.get(table) ?? new Map<string, string>();
    const b = staging.get(table) ?? new Map<string, string>();
    for (const [column, type] of a) {
      const other = b.get(column);
      if (other === undefined) {
        mismatches.push(
          `${table}.${column}: in the copy (${type}), not on staging`,
        );
      } else if (other !== type) {
        mismatches.push(
          `${table}.${column}: ${type} in the copy, ${other} on staging`,
        );
      }
    }
    for (const [column, type] of b) {
      if (!a.has(column)) {
        mismatches.push(
          `${table}.${column}: on staging (${type}), not in the copy`,
        );
      }
    }
  }
  return {
    load,
    copyOnly: [...copy.keys()].filter((t) => !staging.has(t)).sort(),
    stagingOnly: [...staging.keys()].filter((t) => !copy.has(t)).sort(),
    preserved: both.filter((t) => keep.has(t)),
    mismatches,
  };
}

export interface KeepPlan {
  keep: string[];
  missing: string[];
  ambiguous: string[];
}

/** Intersect the configured keep list with the names actually stashed. */
export function planKeptKeys(
  configured: string[],
  stashedNames: string[],
): KeepPlan {
  const counts = new Map<string, number>();
  for (const n of stashedNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const unique = [...new Set(configured)];
  return {
    keep: unique.filter((n) => counts.get(n) === 1),
    missing: unique.filter((n) => !counts.has(n)),
    ambiguous: unique.filter((n) => (counts.get(n) ?? 0) > 1),
  };
}

/** `"schema"."table"` for SQL and for pg_dump's -t (quoted = literal). */
export function quoteTable(qualified: string): string {
  const dot = qualified.indexOf(".");
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return `${ident(qualified.slice(0, dot))}.${ident(qualified.slice(dot + 1))}`;
}

/**
 * The TABLE DATA (and SEQUENCE SET) entries of a `pg_restore -l` listing
 * that belong to `tables`, for restoring just those from a backup.
 * Lines look like `1234; 0 16390 TABLE DATA public users postgres`.
 */
export function filterToc(toc: string, tables: string[]): string[] {
  const want = new Set(tables);
  return toc.split("\n").filter((line) => {
    if (line.startsWith(";")) return false;
    const m = /\s(TABLE DATA|SEQUENCE SET) (\S+) (\S+)(?: |$)/.exec(line);
    if (!m) return false;
    return m[1] === "SEQUENCE SET" || want.has(`${m[2]}.${m[3]}`);
  });
}
