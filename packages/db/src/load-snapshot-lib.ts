/**
 * `pnpm db:load:snapshot`: load the sanitized Prod snapshot (tooling/scripts
 * staging-refresh --snapshot-only) into the local Docker database. All
 * decisions and the whole flow live here behind injected I/O (`LoadDeps`) so
 * unit tests cover them without Docker; load-snapshot.ts wires the real
 * effects.
 *
 * Nothing is changed until every pre-flight check has passed, and the
 * truncate and the restore are one transaction: a bad URL, a damaged archive,
 * a schema mismatch or a failing restore all leave the database as it was.
 */
import { sql } from "drizzle-orm/sql";
import pgConnectionString from "pg-connection-string";
import { z } from "zod";

import type { AppDb } from "./client";
import type { LocalTargetAction } from "./migrate-guards";
import { logInfo, logWarn } from "./lib/logging";
import { LOCAL_PG_CONTAINER } from "./local-docker";
import { LOCAL_API_KEY_REGION_NAMES } from "./local-seed-lib/data";
import { resetAllSequences } from "./local-seed-lib/sequences";
import { DISPOSABLE_MARKER, DISPOSABLE_REMEDY } from "./migrate-guards";

export const SNAPSHOT_URL =
  "https://storage.googleapis.com/f3-public-images/dev-snapshots/f3-dev-snapshot.tar";
const CONTAINER = LOCAL_PG_CONTAINER;
const PG_USER = "f3local";
export const PG_DB = "f3nation";

/** Mirrors SNAPSHOT_FORMAT_VERSION in tooling/scripts staging-refresh.snapshot.ts. */
const SUPPORTED_FORMAT_VERSION = 1;
const MAX_TABLES = 100;
const TABLE_KEY = /^public\.[a-z_][a-z0-9_]*$/;
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TAR_MEMBERS = ["manifest.json", "snapshot.dump"];
/** Snapshots older than this get a warning, not a refusal. */
const STALE_AFTER_DAYS = 30;

export const LOAD_SNAPSHOT_ACTION: LocalTargetAction = {
  verb: "load a snapshot into",
  help: "pnpm db:load:snapshot only loads into the local Docker database (set up with `pnpm local:setup`).",
};

export interface LoadArgs {
  /** Where to download from; ignored when `file` is set. */
  url: string;
  /** A local snapshot tar, e.g. one produced by `staging-refresh --snapshot-out`. */
  file?: string;
  /** Skip the confirmation prompt. */
  yes: boolean;
}

export function parseArgs(argv: string[]): LoadArgs {
  let url: string | undefined;
  let file: string | undefined;
  let yes = false;
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const [flag, inline] = arg.startsWith("--")
      ? (arg.split(/=(.*)/s, 2) as [string, string | undefined])
      : [arg, undefined];
    const value = () => {
      const v = inline ?? args[i + 1];
      if (!v || (inline === undefined && v.startsWith("-"))) {
        throw new Error(`${flag} needs a value`);
      }
      if (inline === undefined) i++;
      return v;
    };
    if (flag === "--url") url = value();
    else if (flag === "--file") file = value();
    else if (flag === "--yes" || flag === "-y") yes = true;
    else throw new Error(`Unknown argument "${arg}"`);
  }
  if (url && file) throw new Error("Pass --url or --file, not both");
  return { url: url ?? SNAPSHOT_URL, file, yes };
}

/** https only; plain http just for a local test server. */
export function validateSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`Snapshot URL must be https (got ${url.protocol})`);
  }
  return url;
}

/** The fields the loader reads from SnapshotManifest in tooling/scripts staging-refresh.snapshot.ts (it ignores `window`). */
export interface SnapshotManifest {
  formatVersion: number;
  exportedAt: string;
  migration: { tag: string; createdAt: number };
  tables: Record<string, { rows: number; columns: string[] }>;
}

/** Manifest keys are `public.<table>`. */
const bareName = (key: string) => key.slice("public.".length);
const tableKey = (name: string) => `public.${name}`;

const ManifestSchema = z.object({
  exportedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v))),
  migration: z.object({ tag: z.string(), createdAt: z.number().finite() }),
  tables: z.record(z.string(), z.unknown()),
});

const TOP_LEVEL_ERRORS = {
  exportedAt: "exportedAt is not a date",
  migration: "migration needs a tag and a createdAt",
  tables: "tables is missing",
} as const;

const TableSchema = z.object({
  rows: z.number(),
  columns: z.array(z.string().regex(COLUMN_NAME)).min(1),
});

const manifestError = (why: string) => new Error(`manifest.json: ${why}`);

/** The manifest is untrusted input: every field that reaches SQL is checked. */
export function parseManifest(raw: string): SnapshotManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("manifest.json is not an object");
  }
  const { formatVersion } = json as { formatVersion?: unknown };
  if (formatVersion !== SUPPORTED_FORMAT_VERSION) {
    throw new Error(
      `Snapshot format ${String(formatVersion)} is not supported (this checkout reads format ${SUPPORTED_FORMAT_VERSION}). Update your checkout, or publish a matching snapshot.`,
    );
  }
  const top = ManifestSchema.safeParse(json);
  if (!top.success) {
    const field = top.error.issues[0]?.path[0] as keyof typeof TOP_LEVEL_ERRORS;
    throw manifestError(TOP_LEVEL_ERRORS[field]);
  }
  const { exportedAt, migration, tables } = top.data;
  const names = Object.keys(tables);
  if (names.length === 0 || names.length > MAX_TABLES) {
    throw manifestError(`expected 1-${MAX_TABLES} tables, got ${names.length}`);
  }
  const parsed: SnapshotManifest["tables"] = {};
  for (const name of names) {
    if (!TABLE_KEY.test(name)) {
      throw manifestError(`"${name}" is not a public table name`);
    }
    const table = TableSchema.safeParse(tables[name]);
    if (!table.success) {
      throw manifestError(`table ${name} is malformed`);
    }
    parsed[name] = table.data;
  }
  return {
    formatVersion: SUPPORTED_FORMAT_VERSION,
    exportedAt,
    migration,
    tables: parsed,
  };
}

export function manifestAge(
  exportedAt: string,
  now: Date,
): { days: number; text: string } {
  const ms = Math.max(0, now.getTime() - Date.parse(exportedAt));
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  const text =
    days >= 1
      ? `${days} day${days === 1 ? "" : "s"} old`
      : hours >= 1
        ? `${hours} hour${hours === 1 ? "" : "s"} old`
        : "less than an hour old";
  return { days, text };
}

/**
 * The tables `pg_restore -l` says the dump holds must be exactly the
 * manifest's: a dump that disagrees with its own manifest is not loaded.
 */
export function assertDumpMatchesManifest(
  toc: string,
  manifest: SnapshotManifest,
): void {
  const inDump = new Set<string>();
  for (const line of toc.split("\n")) {
    const m = /\bTABLE DATA (\S+) (\S+)/.exec(line);
    if (m) inDump.add(`${m[1]}.${m[2]}`);
  }
  const missing = Object.keys(manifest.tables).filter((t) => !inDump.has(t));
  const extra = [...inDump].filter((t) => !(t in manifest.tables));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The dump does not match its manifest (missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}).`,
    );
  }
}

/**
 * Every manifest column must exist locally. A local database that is ahead of
 * the snapshot (extra columns) still loads: the dump names its columns.
 */
export function assertColumns(
  manifest: SnapshotManifest,
  local: Record<string, string[]>,
): void {
  const problems: string[] = [];
  for (const [table, { columns }] of Object.entries(manifest.tables)) {
    const have = local[table];
    if (!have || have.length === 0) {
      problems.push(`${table} does not exist locally`);
      continue;
    }
    const missing = columns.filter((c) => !have.includes(c));
    if (missing.length > 0) {
      problems.push(`${table} has no local column ${missing.join(", ")}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The snapshot does not fit your local schema (${problems.join("; ")}). Update your checkout and run \`pnpm db:migrate:local\`.`,
    );
  }
}

/** Local must have every migration the snapshot has; ahead is fine. */
export function assertMigration(
  localNewest: number | null,
  manifest: SnapshotManifest,
): void {
  if (localNewest === null) {
    throw new Error(
      "The local database has no migration history. Run `pnpm local:setup` (or `pnpm db:migrate:local`) first.",
    );
  }
  if (localNewest < manifest.migration.createdAt) {
    throw new Error(
      `The snapshot is from migration ${manifest.migration.tag}, newer than your local database. Update your checkout and run \`pnpm db:migrate:local\`, then load again.`,
    );
  }
}

/**
 * `tar -tvf` output must list exactly the two expected regular files: no
 * extra members, no paths, no links.
 */
export function assertTarListing(listing: string): void {
  const lines = listing.split("\n").filter((l) => l.trim() !== "");
  if (lines.some((l) => !l.startsWith("-"))) {
    throw new Error("The archive contains something other than regular files.");
  }
  const names = lines.map((l) => l.trim().split(/\s+/).pop()!);
  if (
    names.length !== TAR_MEMBERS.length ||
    !TAR_MEMBERS.every((m) => names.includes(m))
  ) {
    throw new Error(
      `The archive must contain exactly ${TAR_MEMBERS.join(" and ")} (found: ${names.join(", ") || "nothing"}).`,
    );
  }
}

export function truncateSql(tables: string[]): string {
  for (const t of tables) {
    if (!TABLE_KEY.test(t)) throw new Error(`Refusing to truncate "${t}"`);
  }
  const list = tables.map((t) => `"public"."${bareName(t)}"`).join(", ");
  return `TRUNCATE TABLE ${list} CASCADE`;
}

// pg_restore quotes failing rows in some errors; never print them.
const ROW_DATA =
  /Failing row contains|^\s*CONTEXT:\s+COPY .* line \d+|^\s*DETAIL:\s+Key \(/;
// Input errors end with the rejected value: `...type integer: "abc"`.
const QUOTED_VALUE = /(ERROR:.*?:\s*)".*"\s*$/;

export function redactStderr(stderr: string, keep = 5): string {
  return stderr
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) =>
      ROW_DATA.test(l)
        ? "[row data withheld]"
        : l.replace(QUOTED_VALUE, "$1[value withheld]"),
    )
    .slice(0, keep)
    .join(" / ");
}

const brief = (stderr: string) => redactStderr(stderr, 2);

const EXEC_STDIN = ["exec", "-i"];

export const LIST_ARGS = [...EXEC_STDIN, CONTAINER, "pg_restore", "-l"];

/**
 * Runs in the container with the dump on stdin: the script is the truncate
 * plus pg_restore's data-only SQL (triggers off, no ownership), applied by
 * psql in a single transaction. It is built in full before psql starts, so a
 * failing pg_restore never reaches the database, and any SQL error rolls the
 * truncate back. The dev logins need exactly one nation org, so that is
 * checked before the commit too. Only TABLE DATA entries, the ones checked
 * against the manifest, are restored: that leaves out large objects, and
 * SEQUENCE SET, whose setval survives a rollback (the loader resets
 * sequences after the commit instead).
 */
const RESTORE_SCRIPT = `set -euo pipefail
d=$(mktemp) l=$(mktemp) f=$(mktemp)
trap 'rm -f "$d" "$l" "$f"' EXIT
cat > "$d"
pg_restore -l "$d" | awk '/^[0-9]+; [0-9]+ [0-9]+ TABLE DATA /' > "$l"
printf 'SET client_min_messages = warning;\\n%s;\\n' "$TRUNCATE_SQL" > "$f"
pg_restore --data-only --disable-triggers --no-owner -L "$l" -f - "$d" >> "$f"
printf '%s\n' "$NATION_CHECK_SQL" >> "$f"
psql -U ${PG_USER} -d ${PG_DB} -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction -f "$f"`;

export const NATION_CHECK_SQL = `DO $check$ BEGIN
  IF (SELECT count(*) FROM public.orgs WHERE org_type = 'nation') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one nation org in the snapshot';
  END IF;
END $check$;`;

export const restoreArgs = (truncate: string) => [
  ...EXEC_STDIN,
  "-e",
  `TRUNCATE_SQL=${truncate}`,
  "-e",
  `NATION_CHECK_SQL=${NATION_CHECK_SQL}`,
  CONTAINER,
  "bash",
  "-c",
  RESTORE_SCRIPT,
];

export interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** What the loader asks of the local database. */
export interface LoadDb {
  /** The connected database's name, disposable marker and server identity. */
  identity: () => Promise<{
    name: string;
    marker: string | null;
    systemId: string;
  }>;
  localColumns: (tables: string[]) => Promise<Record<string, string[]>>;
  newestMigration: () => Promise<number | null>;
  analyze: () => Promise<void>;
  recomputeAoCounts: () => Promise<void>;
  resetAllSequences: () => Promise<number>;
  nationIds: () => Promise<number[]>;
  regionIdsByName: (names: string[]) => Promise<Record<string, number>>;
}

export interface Seeders {
  seedDevUsers: (nationId: number) => Promise<{
    adminUserId: number;
    roleIds: { adminId: number; editorId: number };
  }>;
  seedApiKeys: (
    adminUserId: number,
    nationId: number,
    roleIds: { adminId: number; editorId: number },
    regionIds: Record<string, number>,
  ) => Promise<string[]>;
  seedOAuthClients: () => Promise<void>;
}

export interface LoadDeps {
  now: () => Date;
  /** `performance.now()`-style milliseconds. */
  clock: () => number;
  isCI: boolean;
  isTTY: boolean;
  databaseUrl: string;
  /** Every URL a client of this process connects with (DATABASE_URL, test URL). */
  targetUrls: string[];
  assertLocal: (url: string) => Promise<void>;
  mkTmp: () => Promise<string>;
  rmTmp: (dir: string) => Promise<void>;
  fetchToFile: (url: URL, dest: string) => Promise<void>;
  copyFile: (src: string, dest: string) => Promise<void>;
  readText: (path: string) => Promise<string>;
  tar: (args: string[]) => Promise<ProcResult>;
  docker: (args: string[], stdinFile?: string) => Promise<ProcResult>;
  confirm: (question: string) => Promise<string>;
  db: LoadDb;
  seeders: Seeders;
}

const dockerPsql = (deps: LoadDeps, query: string) =>
  deps.docker([
    "exec",
    CONTAINER,
    "psql",
    "-U",
    PG_USER,
    "-d",
    PG_DB,
    "-v",
    "ON_ERROR_STOP=1",
    "-tA",
    "-F",
    "|",
    "-c",
    query,
  ]);

/** Refuse unless this process and the Docker container are the same disposable local database. */
async function assertDisposableLocal(deps: LoadDeps): Promise<void> {
  if (deps.isCI) {
    throw new Error("Not loading a snapshot: CI is set.");
  }
  for (const url of deps.targetUrls) {
    await deps.assertLocal(url);
  }
  const urlDb = pgConnectionString.parse(deps.databaseUrl).database;
  if (urlDb !== PG_DB) {
    throw new Error(
      `Refusing to load: DATABASE_URL names "${urlDb ?? ""}", but the loader only loads the Docker "${PG_DB}" database.`,
    );
  }

  const mine = await deps.db.identity();
  if (mine.name !== PG_DB || mine.marker !== DISPOSABLE_MARKER) {
    throw new Error(
      `Refusing to load: the connected database is not a verified disposable local database. ${DISPOSABLE_REMEDY}`,
    );
  }

  const theirs = await dockerPsql(
    deps,
    "SELECT shobj_description(oid, 'pg_database'), (SELECT system_identifier FROM pg_control_system()) FROM pg_database WHERE datname = current_database()",
  );
  if (theirs.code !== 0) {
    throw new Error(
      `Docker is required: could not reach the ${CONTAINER} container (start it with pnpm docker:up). ${brief(theirs.stderr)}`,
    );
  }
  const [marker, systemId] = theirs.stdout.trim().split("|");
  if (marker !== DISPOSABLE_MARKER) {
    throw new Error(
      `Refusing to load: the ${CONTAINER} database is not marked disposable. ${DISPOSABLE_REMEDY}`,
    );
  }
  // The same server on both sides: DATABASE_URL could be a tunnel to another
  // machine while Docker answers for itself.
  if (systemId !== mine.systemId) {
    throw new Error(
      `Refusing to load: DATABASE_URL does not reach the ${CONTAINER} container's Postgres server.`,
    );
  }
}

/** Fetch or copy the snapshot into `dir` and unpack the two expected members. */
async function acquire(
  args: LoadArgs,
  deps: LoadDeps,
  dir: string,
): Promise<void> {
  const tarPath = `${dir}/snapshot.tar`;
  if (args.file) {
    await deps.copyFile(args.file, tarPath);
  } else {
    const url = validateSourceUrl(args.url);
    logInfo("db.snapshot.download_start", {
      host: url.host,
      path: url.pathname,
    });
    await deps.fetchToFile(url, tarPath);
  }
  const listing = await deps.tar(["-tvf", tarPath]);
  if (listing.code !== 0) {
    throw new Error(`Not a readable tar archive: ${brief(listing.stderr)}`);
  }
  assertTarListing(listing.stdout);
  const unpacked = await deps.tar(["-xf", tarPath, "-C", dir, ...TAR_MEMBERS]);
  if (unpacked.code !== 0) {
    throw new Error(`Could not unpack the archive: ${brief(unpacked.stderr)}`);
  }
}

/** Dev logins on the imported nation org. */
async function seedDevLogins(deps: LoadDeps): Promise<void> {
  const nations = await deps.db.nationIds();
  const nationId = nations[0];
  if (nations.length !== 1 || nationId === undefined) {
    throw new Error(
      `Expected exactly one nation org in the snapshot, found ${nations.length}.`,
    );
  }
  const { adminUserId, roleIds } = await deps.seeders.seedDevUsers(nationId);
  const regionIds = await deps.db.regionIdsByName(LOCAL_API_KEY_REGION_NAMES);
  const skipped = await deps.seeders.seedApiKeys(
    adminUserId,
    nationId,
    roleIds,
    regionIds,
  );
  for (const key of skipped) logWarn("db.snapshot.api_key_skipped", { key });
  await deps.seeders.seedOAuthClients();
}

export interface LoadResult {
  tables: number;
  rows: number;
  elapsedMs: number;
}

export async function runLoad(
  args: LoadArgs,
  deps: LoadDeps,
): Promise<LoadResult> {
  const started = deps.clock();

  await assertDisposableLocal(deps);

  const dir = await deps.mkTmp();
  try {
    await acquire(args, deps, dir);
    const dumpPath = `${dir}/snapshot.dump`;

    const manifest = parseManifest(await deps.readText(`${dir}/manifest.json`));
    const age = manifestAge(manifest.exportedAt, deps.now());
    const tables = Object.keys(manifest.tables);
    const rows = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0);
    logInfo("db.snapshot.manifest", {
      exportedAt: manifest.exportedAt,
      age: age.text,
      migration: manifest.migration.tag,
      tables: tables.length,
      rows,
    });
    if (age.days > STALE_AFTER_DAYS) {
      logWarn("db.snapshot.stale", { days: age.days });
    }

    const toc = await deps.docker(LIST_ARGS, dumpPath);
    if (toc.code !== 0) {
      throw new Error(
        `pg_restore could not read the dump: ${redactStderr(toc.stderr)}`,
      );
    }
    assertDumpMatchesManifest(toc.stdout, manifest);
    assertColumns(manifest, await deps.db.localColumns(tables));
    assertMigration(await deps.db.newestMigration(), manifest);

    if (!args.yes) {
      if (!deps.isTTY) {
        throw new Error("Not a terminal: pass --yes to load without a prompt.");
      }
      const answer = await deps.confirm(
        `Replace the data in ${tables.length} tables of the local "${PG_DB}" database with a snapshot exported ${age.text} (${rows} rows)? This also empties anything that references them (attendance, API keys, OAuth tokens, sign-in sessions); dev users and keys are re-created. [y/N] `,
      );
      if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
        throw new Error("Load cancelled");
      }
    }

    const restored = await deps.docker(
      restoreArgs(truncateSql(tables)),
      dumpPath,
    );
    if (restored.code !== 0) {
      throw new Error(
        `The restore failed and was rolled back; the local database is unchanged: ${redactStderr(restored.stderr)}`,
      );
    }

    // Triggers were off during the restore, and the seeders insert next.
    try {
      await deps.db.analyze();
      await deps.db.recomputeAoCounts();
      await deps.db.resetAllSequences();
      await seedDevLogins(deps);
    } catch (err) {
      throw new Error(
        `The snapshot was loaded, but post-load setup failed (dev logins may be missing); run the load again: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const elapsedMs = Math.round(deps.clock() - started);
    logInfo("db.snapshot.done", { tables: tables.length, rows, elapsedMs });
    return { tables: tables.length, rows, elapsedMs };
  } finally {
    // Best-effort: a cleanup failure must not hide the load's own error.
    await deps.rmTmp(dir).catch((err: unknown) => {
      logWarn("db.snapshot.tmp_cleanup_failed", { dir, err: String(err) });
    });
  }
}

/** drizzle spreads an array parameter into a tuple, so list each value. */
const inList = (values: string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

export function createLoadDb(db: AppDb, migrationsTable: string): LoadDb {
  return {
    async identity() {
      const [row] = await db.execute<{
        name: string;
        marker: string | null;
        system_id: string;
      }>(sql`SELECT current_database() AS name,
        shobj_description(oid, 'pg_database') AS marker,
        (SELECT system_identifier::text FROM pg_control_system()) AS system_id
        FROM pg_database WHERE datname = current_database()`);
      if (!row) throw new Error("Could not read the connected database");
      return { name: row.name, marker: row.marker, systemId: row.system_id };
    },

    async localColumns(tables) {
      const names = tables.map(bareName);
      const rows = await db.execute<{
        table_name: string;
        column_name: string;
      }>(
        sql`SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name IN (${inList(names)})`,
      );
      const out: Record<string, string[]> = {};
      for (const { table_name, column_name } of rows) {
        (out[tableKey(table_name)] ??= []).push(column_name);
      }
      return out;
    },

    async newestMigration() {
      const [exists] = await db.execute(
        sql`SELECT 1 FROM pg_tables
          WHERE schemaname = 'drizzle' AND tablename = ${migrationsTable}`,
      );
      if (!exists) return null;
      const [row] = await db.execute<{ newest: string | null }>(
        sql`SELECT max(created_at)::text AS newest
          FROM drizzle.${sql.identifier(migrationsTable)}`,
      );
      return row?.newest ? Number(row.newest) : null;
    },

    async analyze() {
      await db.execute(sql`ANALYZE`);
    },

    // The trigger that keeps ao_count current is off during a restore.
    async recomputeAoCounts() {
      await db.execute(sql`SELECT public.recount_org_ao_counts()`);
    },

    resetAllSequences: () => resetAllSequences(db),

    async nationIds() {
      const rows = await db.execute<{ id: number }>(
        sql`SELECT id FROM orgs WHERE org_type = 'nation' ORDER BY id`,
      );
      return rows.map((r) => r.id);
    },

    async regionIdsByName(names) {
      if (names.length === 0) return {};
      const rows = await db.execute<{ id: number; name: string }>(
        sql`SELECT id, name FROM orgs
          WHERE org_type = 'region' AND name IN (${inList(names)})
          ORDER BY id DESC`,
      );
      // Region names aren't unique; the lowest id wins (last write, DESC).
      const out: Record<string, number> = {};
      for (const { id, name } of rows) out[name] = id;
      return out;
    },
  };
}
