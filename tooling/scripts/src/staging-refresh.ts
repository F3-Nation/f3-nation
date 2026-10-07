/**
 * One-command staging refresh (F3-65): prod -> throwaway copy -> obfuscate
 * -> verify -> load into staging, with automatic rollback.
 *
 * Normally run as the Cloud Run job `f3-staging-refresh` (the container
 * starts its own throwaway Postgres for the copy; see
 * tooling/scripts/staging-refresh/):
 *
 *   gcloud run jobs execute f3-staging-refresh --project f3data --region us-central1 --wait
 *
 * Or directly, with pg_dump/pg_restore 18 on PATH (or PG_BIN_DIR):
 *
 *   PROD_DATABASE_URL=...          read-only login on prod
 *   STAGING_DATABASE_URL=...       login that owns staging's tables
 *   INTERMEDIATE_DATABASE_URL=...  an EMPTY throwaway database for the copy
 *   OBFUSCATION_SALT=...           the prod secret (see obfuscate-db.ts)
 *   pnpm -F @acme/scripts staging-refresh -- --allow-staging-db <name> [--dry-run | --yes]
 *
 * A URL may name a unix socket the libpq way:
 * postgresql://user:pass@localhost/db?host=/cloudsql/<project>:<region>:<instance>
 *
 * Flags:
 *   --allow-staging-db <name>  Exact name of the staging database (refuses a
 *                              name that looks like production).
 *   --dry-run                  Everything up to and including the obfuscation,
 *                              the verify suite and the load-set checks; never
 *                              writes to staging.
 *   --yes                      Required for the real run.
 *   --skip-slackbot-restart    Print the restart command instead of running it.
 *   --reuse-existing-stash     Use refresh_keep / refresh_keep_slack left on
 *                              staging by a run whose rollback failed, instead
 *                              of refusing.
 *
 * Steps (docs/STAGING_REFRESH.md has the why of each):
 *   1. preflight: guards, pg tool versions, migration gate, staging lock
 *   2. dump prod (public, auth, drizzle, slackbot if present)
 *   3. restore into the copy; the raw dump is deleted right after
 *   4. obfuscate-db, then obfuscate-db.verify-target (must pass 100%)
 *   5. plan the load: shared tables minus PRESERVED_TABLES, identical columns
 *   6. dump the obfuscated load set                         <- --dry-run stops here
 *   7. back up staging's load set (data only), stash API keys + Slack rows
 *   8. drop FKs + truncate (one transaction)                <- staging changes here
 *   9. pg_restore, row counts, FKs back NOT VALID, keys + Slack back,
 *      sequences, ANALYZE          (any failure from 8 on: automatic rollback)
 *  10. restart the staging slackbot (best effort)
 *  11. VALIDATE each FK on its own
 *  12. summary
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type postgres from "postgres";

import type {
  AppliedMigration,
  JournalEntry,
  LoadPlan,
  TableColumns,
} from "./staging-refresh.checks";
import {
  databaseNameFromUrl,
  libpqEnv,
  looksLikeProdDbName,
  openPostgres,
} from "./db-url";
import {
  filterToc,
  migrationGate,
  planKeptKeys,
  planLoad,
  quoteTable,
} from "./staging-refresh.checks";
import {
  PRESERVED_TABLES,
  STAGING_API_KEYS_TO_KEEP,
  STAGING_SLACKBOT,
} from "./staging-refresh.config";
import { flagValue } from "./staging-target";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const YES = argv.includes("--yes");
const SKIP_SLACKBOT_RESTART = argv.includes("--skip-slackbot-restart");
const REUSE_STASH = argv.includes("--reuse-existing-stash");
const STAGING_DB = flagValue(argv, "--allow-staging-db");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, "..");
const JOURNAL_PATH = path.resolve(
  HERE,
  "../../../packages/db/drizzle/meta/_journal.json",
);

/** Schemas taken from prod. Never codex/regionpages/temp: unclassified PII. */
const DUMP_SCHEMAS = ["public", "auth", "drizzle", "slackbot"];
/** Schemas whose tables are loaded into staging. */
const LOAD_SCHEMAS = ["public", "auth", "slackbot"];
const STASH_SCHEMAS = { keys: "refresh_keep", slack: "refresh_keep_slack" };
/** Staging's FK definitions while they are dropped (see stashFks). */
const FK_STASH = "refresh_keep_fks";
const LOCK_KEY = "f3-staging-refresh";

type Sql = postgres.Sql;

// ---------------------------------------------------------------------------
// Output and timing
// ---------------------------------------------------------------------------

const timings: { step: string; ms: number }[] = [];
const warnings: string[] = [];
const startedAt = Date.now();

function log(line = ""): void {
  console.log(line);
}

function warn(line: string): void {
  warnings.push(line);
  console.log(`   WARNING: ${line}`);
}

function minutes(ms: number): string {
  return ms < 60_000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

async function step<T>(title: string, fn: () => Promise<T>): Promise<T> {
  log(`\n== ${title}`);
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    timings.push({ step: title, ms });
    log(`   (${minutes(ms)})`);
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

const listOrNone = (items: string[]): string =>
  items.length > 0 ? items.join(", ") : "none";

/** Refused before staging was written: nothing to roll back. */
class Refusal extends Error {}

// ---------------------------------------------------------------------------
// Child processes. stdin is always ignored: a child must never read the
// orchestrator's stdin (the 2026-10-07 FK loop validated 1 of 74 because
// `docker run -i` swallowed the rest of its input).
// ---------------------------------------------------------------------------

interface RunResult {
  code: number;
  stdout: string;
  stderr: string[];
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

// Server messages that quote row values (a failing row, a duplicate key, the
// COPY line). The data is obfuscated by then, but free text can still name
// people (see the SCRUB limit in docs/STAGING_REFRESH.md): keep it out of the
// job's logs.
const ROW_DATA =
  /Failing row contains|^\s*CONTEXT:\s+COPY .* line \d+|^\s*DETAIL:\s+Key \(/;

function run(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd?: string; quietStderr?: RegExp },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const stderr: string[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      stdout += `${line}\n`;
      log(`   | ${line}`);
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (stderr.length < 5000) stderr.push(line);
      if (ROW_DATA.test(line)) log("   ! [row data withheld from the log]");
      else if (!opts.quietStderr?.test(line)) log(`   ! ${line}`);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const PG_BIN_DIR = process.env.PG_BIN_DIR ?? "";
const pgBin = (tool: string) =>
  PG_BIN_DIR ? path.join(PG_BIN_DIR, tool) : tool;

/** pg_dump / pg_restore with credentials in the environment, never argv. */
async function pgTool(
  tool: "pg_dump" | "pg_restore",
  args: string[],
  url: string,
  opts: { pgoptions?: string; benignError?: RegExp; quietStderr?: RegExp } = {},
): Promise<void> {
  const env: Record<string, string> = {
    ...baseEnv(),
    ...libpqEnv(url),
    PGCONNECT_TIMEOUT: "30",
  };
  if (opts.pgoptions) env.PGOPTIONS = opts.pgoptions;
  const result = await run(pgBin(tool), args, {
    env,
    quietStderr: opts.quietStderr,
  });
  if (result.code === 0) return;
  // pg_restore exits 1 when it "ignored" errors. Only the expected ones are
  // allowed through (e.g. `schema "auth" already exists` on the copy).
  const errors = result.stderr.filter((l) => /\berror:/.test(l));
  const real = errors.filter((l) => !opts.benignError?.test(l));
  if (opts.benignError && errors.length > 0 && real.length === 0) {
    log(`   ${tool}: ${errors.length} expected error(s) ignored`);
    return;
  }
  throw new Error(
    `${tool} exited with ${result.code}: ${(real.length > 0 ? real : result.stderr).slice(0, 5).join(" / ")}`,
  );
}

/** One of this package's scripts, against `databaseUrl`. */
async function runScript(
  script: string,
  args: string[],
  databaseUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  // Children get only the database they work on: never the other URLs.
  const env = {
    ...baseEnv(),
    SKIP_ENV_VALIDATION: "1",
    DATABASE_URL: databaseUrl,
    ...extraEnv,
  };
  return run(
    process.execPath,
    ["--import", "tsx", path.join(HERE, `${script}.ts`), ...args],
    { env, cwd: SCRIPTS_DIR },
  );
}

function pgMajor(tool: string): number | undefined {
  const out = spawnSync(pgBin(tool), ["--version"], { encoding: "utf8" });
  const m = /\(PostgreSQL\) (\d+)/.exec(out.stdout);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Catalog reads
// ---------------------------------------------------------------------------

async function tableColumns(
  sql: Sql,
  schemas: string[],
): Promise<TableColumns> {
  const rows = await sql<{ tbl: string; col: string; type: string }[]>`
    SELECT n.nspname || '.' || c.relname AS tbl, a.attname AS col,
      format_type(a.atttypid, a.atttypmod)
        || CASE WHEN a.attgenerated <> '' THEN ' (generated)' ELSE '' END AS type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND NOT c.relispartition AND n.nspname = ANY(${schemas})
    ORDER BY 1, a.attnum`;
  const out: TableColumns = new Map();
  for (const r of rows) {
    const cols = out.get(r.tbl) ?? new Map<string, string>();
    cols.set(r.col, r.type);
    out.set(r.tbl, cols);
  }
  return out;
}

async function schemasPresent(sql: Sql, schemas: string[]): Promise<string[]> {
  const rows = await sql<{ nspname: string }[]>`
    SELECT nspname FROM pg_namespace WHERE nspname = ANY(${schemas})`;
  const present = new Set(rows.map((r) => r.nspname));
  return schemas.filter((s) => present.has(s));
}

async function appliedMigrations(
  sql: Sql,
  label: string,
): Promise<AppliedMigration[]> {
  const [{ db } = { db: "" }] = await sql<{ db: string }[]>`
    SELECT current_database() AS db`;
  const tables = (
    await sql<{ t: string }[]>`
      SELECT tablename AS t FROM pg_tables
      WHERE schemaname = 'drizzle' AND tablename LIKE '\\_\\_drizzle\\_migrations%'`
  ).map((r) => r.t);
  const preferred = `__drizzle_migrations_${db}`;
  const table = tables.includes(preferred)
    ? preferred
    : tables.length === 1
      ? tables[0]
      : undefined;
  if (!table) {
    throw new Refusal(
      `${label}: can't tell which drizzle migrations table is current (found: ${listOrNone(tables)}; expected ${preferred}).`,
    );
  }
  const rows = await sql<{ created_at: string; hash: string }[]>`
    SELECT created_at::text AS created_at, hash FROM ${sql(`drizzle.${table}`)}`;
  return rows.map((r) => ({ createdAt: Number(r.created_at), hash: r.hash }));
}

interface ForeignKey {
  table: string; // quoted "schema"."table"
  name: string; // quoted
  def: string; // pg_get_constraintdef, without any trailing NOT VALID
  validated: boolean;
}

/** Every FK on, or pointing at, a table in the load schemas. */
async function foreignKeys(sql: Sql): Promise<ForeignKey[]> {
  const rows = await sql<
    { tbl: string; name: string; def: string; validated: boolean }[]
  >`
    SELECT format('%I.%I', n.nspname, c.relname) AS tbl,
      quote_ident(co.conname) AS name,
      pg_get_constraintdef(co.oid) AS def,
      co.convalidated AS validated
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class rc ON rc.oid = co.confrelid
    JOIN pg_namespace rn ON rn.oid = rc.relnamespace
    WHERE co.contype = 'f' AND co.conparentid = 0
      AND (n.nspname = ANY(${LOAD_SCHEMAS}) OR rn.nspname = ANY(${LOAD_SCHEMAS}))
      AND n.nspname NOT LIKE 'refresh\\_keep%'
    ORDER BY 1, 2`;
  return rows.map((r) => ({
    table: r.tbl,
    name: r.name,
    def: r.def.replace(/\s+NOT VALID$/, ""),
    validated: r.validated,
  }));
}

async function rowCounts(
  sql: Sql,
  tables: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const t of tables) {
    const [row] = await sql.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM ${quoteTable(t)}`,
    );
    out.set(t, Number(row?.n ?? 0));
  }
  return out;
}

/** md5 over every row, to prove a table was left alone. */
async function tableHash(sql: Sql, table: string): Promise<string> {
  const [row] = await sql.unsafe<{ h: string | null; n: string }[]>(
    `SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*)::text AS n
     FROM ${quoteTable(table)} x`,
  );
  return `${row?.n ?? "0"} rows, ${row?.h ?? "empty"}`;
}

async function hasSchema(sql: Sql, schema: string): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT to_regnamespace(${schema}) IS NOT NULL AS present`;
  return row?.present === true;
}

// ---------------------------------------------------------------------------
// Staging writes
// ---------------------------------------------------------------------------

async function dropFksAndTruncate(
  sql: Sql,
  fks: ForeignKey[],
  tables: string[],
): Promise<void> {
  await sql.begin(async (tx) => {
    // Fail fast rather than queue behind an app's long transaction; nothing
    // has changed if this times out.
    await tx`SET LOCAL lock_timeout = '60s'`;
    for (const fk of fks) {
      await tx.unsafe(
        `ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.name}`,
      );
    }
    await tx.unsafe(`TRUNCATE TABLE ${tables.map(quoteTable).join(", ")}`);
  });
}

/**
 * Keep the dropped FKs' definitions on staging until they are back: if the
 * run dies mid-load, or a rollback fails, the in-memory copy dies with the
 * container, and a later --reuse-existing-stash run re-adds them from here.
 */
async function stashFks(sql: Sql, fks: ForeignKey[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`DROP SCHEMA IF EXISTS ${FK_STASH} CASCADE`);
    await tx.unsafe(`CREATE SCHEMA ${FK_STASH}`);
    await tx.unsafe(
      `CREATE TABLE ${FK_STASH}.foreign_keys (tbl text NOT NULL, name text NOT NULL, def text NOT NULL, validated boolean NOT NULL, PRIMARY KEY (tbl, name))`,
    );
    for (const fk of fks) {
      await tx`
        INSERT INTO ${tx(`${FK_STASH}.foreign_keys`)} (tbl, name, def, validated)
        VALUES (${fk.table}, ${fk.name}, ${fk.def}, ${fk.validated})`;
    }
  });
}

async function stashedFks(sql: Sql): Promise<ForeignKey[]> {
  const rows = await sql<ForeignKey[]>`
    SELECT tbl AS table, name, def, validated
    FROM ${sql(`${FK_STASH}.foreign_keys`)} ORDER BY tbl, name`;
  return [...rows];
}

/** Union by table + constraint name; the first list wins. */
function mergeFks(first: ForeignKey[], second: ForeignKey[]): ForeignKey[] {
  const key = (fk: ForeignKey) => `${fk.table} ${fk.name}`;
  const seen = new Set(first.map(key));
  return [...first, ...second.filter((fk) => !seen.has(key(fk)))];
}

/** Re-add whichever of `fks` is missing right now (NOT VALID). */
async function addMissingFks(sql: Sql, fks: ForeignKey[]): Promise<number> {
  const present = new Set(
    (await foreignKeys(sql)).map((fk) => `${fk.table} ${fk.name}`),
  );
  const missing = fks.filter((fk) => !present.has(`${fk.table} ${fk.name}`));
  if (missing.length > 0) await addFksNotValid(sql, missing);
  return missing.length;
}

async function addFksNotValid(sql: Sql, fks: ForeignKey[]): Promise<void> {
  await sql.begin(async (tx) => {
    for (const fk of fks) {
      await tx.unsafe(
        `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} ${fk.def} NOT VALID`,
      );
    }
  });
}

async function resetSequences(sql: Sql): Promise<number> {
  const seqs = await sql<{ tbl: string; col: string; seq: string }[]>`
    SELECT format('%I.%I', n.nspname, c.relname) AS tbl, quote_ident(a.attname) AS col,
      pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = ANY(${LOAD_SCHEMAS}) AND c.relkind = 'r'
      AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL`;
  await sql.begin(async (tx) => {
    for (const s of seqs) {
      await tx.unsafe(
        `SELECT setval($1, coalesce(m, 1), m IS NOT NULL) FROM (SELECT max(${s.col}) AS m FROM ${s.tbl}) x`,
        [s.seq],
      );
    }
  });
  return seqs.length;
}

/**
 * VALIDATE each FK as its own statement (autocommit). Validating them all
 * in one transaction took over an hour and lost its connection (2026-09-22).
 */
async function validateFks(
  sql: Sql,
  fks: ForeignKey[],
): Promise<{ validated: number; failed: string[] }> {
  const failed: string[] = [];
  let validated = 0;
  let i = 0;
  for (const fk of fks) {
    i += 1;
    const stmt = `ALTER TABLE ${fk.table} VALIDATE CONSTRAINT ${fk.name}`;
    let error: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await sql.unsafe(stmt);
        error = undefined;
        break;
      } catch (e) {
        error = e;
        // Retry only a dropped connection, not a constraint violation.
        const code = (e as { code?: string }).code ?? "";
        if (!/^(CONNECTION_|ECONN|EPIPE)/.test(code)) break;
      }
    }
    if (error === undefined) {
      validated += 1;
    } else {
      const msg = errMsg(error);
      failed.push(`${fk.table} ${fk.name}: ${msg.slice(0, 200)}`);
      log(
        `   FAIL ${i}/${fks.length} ${fk.table} ${fk.name}: ${msg.slice(0, 200)}`,
      );
    }
    if (i % 10 === 0 || i === fks.length) {
      log(`   ${i}/${fks.length} checked, ${validated} validated`);
    }
  }
  if (validated + failed.length !== fks.length) {
    throw new Error(
      `FK validation bookkeeping is off: ${validated} validated + ${failed.length} failed != ${fks.length}`,
    );
  }
  return { validated, failed };
}

/** Restart the staging slackbot (a new revision drops its cached links). */
async function restartSlackbot(): Promise<string> {
  const { project, region, service } = STAGING_SLACKBOT;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const command =
    `gcloud run services update ${service} --project ${project} --region ${region} ` +
    `--update-env-vars REFRESHED_AT=${stamp} --quiet`;
  const manual = (why: string) =>
    `NOT restarted (${why}). Ask someone with access to ${project} to run:\n     ${command}`;
  if (SKIP_SLACKBOT_RESTART) return manual("--skip-slackbot-restart");

  if (process.env.CLOUD_RUN_JOB) {
    // In the job: Cloud Run Admin API with the runtime service account.
    try {
      const tokenRes = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" } },
      );
      if (!tokenRes.ok)
        return manual(`metadata token: HTTP ${tokenRes.status}`);
      const { access_token: token } = (await tokenRes.json()) as {
        access_token: string;
      };
      const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const getRes = await fetch(url, { headers });
      if (!getRes.ok) return manual(`read service: HTTP ${getRes.status}`);
      const svc = (await getRes.json()) as {
        template?: {
          revision?: string;
          containers?: { env?: { name: string; value?: string }[] }[];
        };
      };
      const container = svc.template?.containers?.[0];
      if (!svc.template || !container)
        return manual("service has no container");
      // A pinned revision name would collide with the running revision.
      delete svc.template.revision;
      container.env = [
        ...(container.env ?? []).filter((e) => e.name !== "REFRESHED_AT"),
        { name: "REFRESHED_AT", value: stamp },
      ];
      const patchRes = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(svc),
      });
      if (!patchRes.ok)
        return manual(`update service: HTTP ${patchRes.status}`);
      return `restarted (new revision with REFRESHED_AT=${stamp} rolling out)`;
    } catch (e) {
      return manual(errMsg(e));
    }
  }

  const gcloud = spawnSync("gcloud", ["--version"], { stdio: "ignore" });
  if (gcloud.status !== 0) return manual("no gcloud here");
  const res = spawnSync(
    "gcloud",
    [
      "run",
      "services",
      "update",
      service,
      "--project",
      project,
      "--region",
      region,
      "--update-env-vars",
      `REFRESHED_AT=${stamp}`,
      "--quiet",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (res.status === 0) return `restarted (REFRESHED_AT=${stamp})`;
  return manual(
    `gcloud: ${res.stderr.trim().split("\n").slice(-1)[0] ?? "failed"}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Context {
  prodUrl: string;
  stagingUrl: string;
  copyUrl: string;
  copyDb: string;
  stagingDb: string;
  work: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Refusal(`${name} is not set`);
  return v;
}

function connect(url: string, extra: Record<string, string> = {}): Sql {
  return openPostgres(url, {
    max: 1,
    onnotice: () => undefined,
    // The FK definitions are saved and replayed on different connections:
    // pin the search_path so pg_get_constraintdef qualifies names the same
    // way every time.
    connection: {
      application_name: "f3-staging-refresh",
      search_path: "public",
      ...extra,
    },
  });
}

function guards(): Context {
  if (!STAGING_DB) {
    throw new Refusal(
      "pass --allow-staging-db <name> naming the exact staging database.",
    );
  }
  if (looksLikeProdDbName(STAGING_DB)) {
    throw new Refusal(`"${STAGING_DB}" is (or looks like) production.`);
  }
  const prodUrl = requireEnv("PROD_DATABASE_URL");
  const stagingUrl = requireEnv("STAGING_DATABASE_URL");
  const copyUrl = requireEnv("INTERMEDIATE_DATABASE_URL");
  requireEnv("OBFUSCATION_SALT");
  if (databaseNameFromUrl(stagingUrl) !== STAGING_DB) {
    throw new Refusal(
      `STAGING_DATABASE_URL does not point at "${STAGING_DB}".`,
    );
  }
  const prodDb = databaseNameFromUrl(prodUrl);
  const copyDb = databaseNameFromUrl(copyUrl);
  if (!prodDb || !copyDb) throw new Refusal("a database URL names no database");
  if (prodDb === STAGING_DB) {
    throw new Refusal(
      "PROD_DATABASE_URL and STAGING_DATABASE_URL name the same database.",
    );
  }
  if (
    copyDb === STAGING_DB ||
    copyDb === prodDb ||
    looksLikeProdDbName(copyDb)
  ) {
    throw new Refusal(
      `INTERMEDIATE_DATABASE_URL names "${copyDb}": it must be a throwaway database, not staging or prod.`,
    );
  }
  const work = mkdtempSync(path.join(os.tmpdir(), "staging-refresh-"));
  return { prodUrl, stagingUrl, copyUrl, copyDb, stagingDb: STAGING_DB, work };
}

async function main(): Promise<number> {
  log(
    `F3 staging refresh${DRY_RUN ? " (DRY RUN: staging is not written)" : ""} — ${new Date().toISOString()}`,
  );
  const ctx = guards();
  const prod = connect(ctx.prodUrl, { default_transaction_read_only: "on" });
  const copy = connect(ctx.copyUrl);
  const stg = connect(ctx.stagingUrl);
  const files = {
    prodDump: path.join(ctx.work, "prod.dump"),
    loadDump: path.join(ctx.work, "load.dump"),
    backup: path.join(ctx.work, "staging-backup.dump"),
    toc: path.join(ctx.work, "list.toc"),
  };
  // Staging state, for the rollback decision.
  let wiped = false;
  const stashedHere: string[] = [];
  let plan: LoadPlan | undefined;
  let savedFks: ForeignKey[] = [];

  try {
    // ---- 1. preflight ------------------------------------------------------
    const preflight = await step("1/12 preflight (read-only)", async () => {
      for (const tool of ["pg_dump", "pg_restore"]) {
        const major = pgMajor(tool);
        if (major !== 18) {
          throw new Refusal(
            `${tool} must be version 18 (the servers run Postgres 18); found ${major ?? "none"}. Set PG_BIN_DIR.`,
          );
        }
      }
      for (const [label, sql, want] of [
        ["staging", stg, ctx.stagingDb],
        ["copy", copy, ctx.copyDb],
      ] as const) {
        const [row] = await sql<
          { db: string }[]
        >`SELECT current_database() AS db`;
        if (row?.db !== want) {
          throw new Refusal(
            `${label}: connected to "${row?.db}", expected "${want}".`,
          );
        }
      }
      const [prodRow] = await prod<{ db: string; ro: string }[]>`
        SELECT current_database() AS db, current_setting('transaction_read_only') AS ro`;
      if (prodRow?.ro !== "on")
        throw new Refusal("prod session is not read-only");
      log(
        `   prod ${prodRow.db} (read-only), staging ${ctx.stagingDb}, copy ${ctx.copyDb}`,
      );

      const [lock] = await stg<{ ok: boolean }[]>`
        SELECT pg_try_advisory_lock(hashtext(${LOCK_KEY})) AS ok`;
      if (!lock?.ok)
        throw new Refusal(
          "another staging refresh is running (advisory lock held).",
        );

      for (const schema of [...Object.values(STASH_SCHEMAS), FK_STASH]) {
        if ((await hasSchema(stg, schema)) && !REUSE_STASH) {
          throw new Refusal(
            `staging already has schema ${schema}: an earlier refresh stopped half-way and its rollback ` +
              `did not finish. It holds staging's own API keys / Slack rows / FK definitions. If staging's tables are ` +
              `empty, re-run with --reuse-existing-stash to load and put them back; otherwise ask ` +
              `someone with staging DB access to inspect it before dropping it.`,
          );
        }
      }

      const [copyTables] = await copy<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'm') AND n.nspname = ANY(${DUMP_SCHEMAS})`;
      if ((copyTables?.n ?? 0) > 0) {
        throw new Refusal(
          `the copy database ${ctx.copyDb} is not empty; give the refresh a fresh one.`,
        );
      }

      const journal = (
        JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
          entries: JournalEntry[];
        }
      ).entries;
      const gate = migrationGate(
        await appliedMigrations(prod, "prod"),
        await appliedMigrations(stg, "staging"),
        journal,
      );
      for (const w of gate.warnings) warn(`migrations: ${w}`);
      if (gate.errors.length > 0) {
        throw new Refusal(
          `migration gate:\n   - ${gate.errors.join("\n   - ")}`,
        );
      }
      log(
        `   migrations: prod and staging at the same level (${journal.length} in the repo journal)`,
      );

      const dumpSchemas = await schemasPresent(prod, DUMP_SCHEMAS);
      for (const required of ["public", "auth", "drizzle"]) {
        if (!dumpSchemas.includes(required))
          throw new Refusal(`prod has no ${required} schema`);
      }
      log(`   will dump prod schemas: ${dumpSchemas.join(", ")}`);
      return { dumpSchemas };
    });

    // ---- 2. dump prod --------------------------------------------------------
    await step("2/12 dump prod", async () => {
      await pgTool(
        "pg_dump",
        [
          "-Fc",
          "--no-owner",
          "--no-privileges",
          "--no-publications",
          "--no-subscriptions",
          ...preflight.dumpSchemas.flatMap((s) => ["-n", `"${s}"`]),
          "-f",
          files.prodDump,
        ],
        ctx.prodUrl,
        { pgoptions: "-c default_transaction_read_only=on" },
      );
    });

    // ---- 3. restore into the copy --------------------------------------------
    await step("3/12 restore into the throwaway copy", async () => {
      const exts = await prod<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`;
      for (const { extname } of exts) {
        try {
          await copy.unsafe(
            `CREATE EXTENSION IF NOT EXISTS "${extname.replace(/"/g, '""')}"`,
          );
        } catch {
          log(`   (extension ${extname} not available on the copy; skipped)`);
        }
      }
      for (const s of preflight.dumpSchemas) {
        await copy.unsafe(`CREATE SCHEMA IF NOT EXISTS "${s}"`);
      }
      try {
        await pgTool(
          "pg_restore",
          [
            "--no-owner",
            "--no-privileges",
            "--no-publications",
            "--no-subscriptions",
            "-j",
            String(Math.max(1, Math.min(8, os.availableParallelism()))),
            "-d",
            ctx.copyDb,
            files.prodDump,
          ],
          ctx.copyUrl,
          {
            benignError: /already exists/,
            quietStderr: /already exists|Command was:|^\s*$/,
          },
        );
      } finally {
        // Raw prod data must not outlive the restore.
        rmSync(files.prodDump, { force: true });
        log("   raw prod dump deleted");
      }
      const prodTables = await tableColumns(prod, preflight.dumpSchemas);
      const copyTables = await tableColumns(copy, preflight.dumpSchemas);
      const missing = [...prodTables.keys()].filter((t) => !copyTables.has(t));
      if (missing.length > 0) {
        throw new Refusal(`restore lost table(s): ${missing.join(", ")}`);
      }
      log(`   ${copyTables.size} tables restored`);
    });
    // Nothing reads prod after this.
    await prod.end();

    // ---- 4. obfuscate + verify -----------------------------------------------
    await step("4/12 obfuscate the copy, then verify it", async () => {
      const salt = requireEnv("OBFUSCATION_SALT");
      const obf = await runScript(
        "obfuscate-db",
        ["--allow-db", ctx.copyDb, "--i-understand-this-rewrites-data"],
        ctx.copyUrl,
        { OBFUSCATION_SALT: salt },
      );
      if (obf.code !== 0) {
        throw new Refusal(
          "obfuscate-db failed (see above); staging was not touched.",
        );
      }
      const verify = await runScript(
        "obfuscate-db.verify-target",
        [],
        ctx.copyUrl,
      );
      if (verify.code !== 0 || !/ALL \d+ CHECKS PASSED/.test(verify.stdout)) {
        throw new Refusal(
          "verify-target did not pass 100% (see above); staging was not touched.",
        );
      }
    });

    // ---- 5. load plan --------------------------------------------------------
    const counts = await step("5/12 plan the load", async () => {
      plan = planLoad(
        await tableColumns(copy, LOAD_SCHEMAS),
        await tableColumns(stg, LOAD_SCHEMAS),
        PRESERVED_TABLES,
      );
      log(
        `   load ${plan.load.length} table(s); preserve ${listOrNone(plan.preserved)}`,
      );
      if (plan.copyOnly.length > 0) {
        log(`   skipped (not on staging): ${plan.copyOnly.join(", ")}`);
      }
      if (plan.stagingOnly.length > 0) {
        log(`   left alone (staging only): ${plan.stagingOnly.join(", ")}`);
      }
      if (plan.mismatches.length > 0) {
        throw new Refusal(
          `copy and staging tables differ, so a data-only load can't work:\n   - ${plan.mismatches.join("\n   - ")}`,
        );
      }
      // staging-slack restores these from its stash and needs them emptied
      // by the load.
      const notLoaded = [
        "public.slack_spaces",
        "public.slack_users",
        "public.orgs_x_slack_spaces",
        "slackbot.f3versary_delivery_runs",
        "slackbot.f3versary_delivery_pages",
      ].filter((t) => plan?.stagingOnly.includes(t));
      if (notLoaded.length > 0) {
        throw new Refusal(
          `staging has ${notLoaded.join(", ")} but the copy doesn't; the Slack stash can't go back. Run the refresh once prod has the same migrations.`,
        );
      }
      return rowCounts(copy, plan.load);
    });
    const load = plan?.load ?? [];

    // ---- 6. dump the load set ------------------------------------------------
    await step("6/12 dump the obfuscated load set", async () => {
      await pgTool(
        "pg_dump",
        [
          "-Fc",
          "-a",
          "--no-owner",
          "--no-privileges",
          ...load.flatMap((t) => ["-t", quoteTable(t)]),
          "-f",
          files.loadDump,
        ],
        ctx.copyUrl,
        {
          quietStderr: /circular|foreign-key|detail:|hint:|--disable-triggers/i,
        },
      );
      await pgTool(
        "pg_restore",
        ["-l", "-f", files.toc, files.loadDump],
        ctx.copyUrl,
      );
      const entries = filterToc(readFileSync(files.toc, "utf8"), load).filter(
        (l) => l.includes(" TABLE DATA "),
      );
      if (entries.length !== load.length) {
        throw new Refusal(
          `load dump holds ${entries.length} tables, expected ${load.length}`,
        );
      }
      log(
        `   ${entries.length} tables, ${[...counts.values()].reduce((a, b) => a + b, 0)} rows`,
      );
    });

    const preservedBefore = new Map<string, string>();
    for (const t of plan?.preserved ?? [])
      preservedBefore.set(t, await tableHash(stg, t));

    if (DRY_RUN) {
      printSummary({ ctx, plan, counts, dryRun: true });
      log(
        "\nSTAGING REFRESH DRY RUN: OK — everything checks out; staging was not touched.",
      );
      return 0;
    }
    if (!YES) throw new Refusal("pass --yes for the real run (or --dry-run).");

    // ---- 7. backup + stash -----------------------------------------------------
    const keepPlan = await step(
      "7/12 back up staging, stash its API keys and Slack rows",
      async () => {
        await pgTool(
          "pg_dump",
          [
            "-Fc",
            "-a",
            "--no-owner",
            "--no-privileges",
            ...load.flatMap((t) => ["-t", quoteTable(t)]),
            "-f",
            files.backup,
          ],
          ctx.stagingUrl,
          {
            quietStderr:
              /circular|foreign-key|detail:|hint:|--disable-triggers/i,
          },
        );
        await pgTool(
          "pg_restore",
          ["-l", "-f", files.toc, files.backup],
          ctx.stagingUrl,
        );
        const backedUp = filterToc(
          readFileSync(files.toc, "utf8"),
          load,
        ).filter((l) => l.includes(" TABLE DATA ")).length;
        if (backedUp !== load.length) {
          throw new Refusal(
            `staging backup holds ${backedUp} tables, expected ${load.length}`,
          );
        }
        log(`   backup: ${backedUp} tables`);

        for (const [kind, script] of [
          ["keys", "staging-api-keys"],
          ["slack", "staging-slack"],
        ] as const) {
          const schema = STASH_SCHEMAS[kind];
          if (await hasSchema(stg, schema)) {
            log(`   reusing the existing ${schema} (--reuse-existing-stash)`);
            continue;
          }
          const res = await runScript(
            script,
            ["--allow-db", ctx.stagingDb, "--stash"],
            ctx.stagingUrl,
          );
          if (res.code !== 0) throw new Refusal(`${script} --stash failed`);
          stashedHere.push(schema);
        }

        const stashed = await stg<
          { id: number; name: string; owner_id: number | null }[]
        >`
        SELECT id, name, owner_id FROM refresh_keep.api_keys ORDER BY id`;
        const kp = planKeptKeys(
          STAGING_API_KEYS_TO_KEEP,
          stashed.map((k) => k.name),
        );
        for (const name of kp.missing)
          warn(`API key "${name}" is in the keep list but not on staging`);
        if (kp.ambiguous.length > 0) {
          throw new Refusal(
            `more than one staging API key is named ${kp.ambiguous.map((n) => `"${n}"`).join(", ")}; ` +
              `revoke or rename the extra one on staging (or fix the keep list in staging-refresh.config.ts).`,
          );
        }
        const kept = stashed.filter((k) => kp.keep.includes(k.name));
        const ownerIds = kept
          .map((k) => k.owner_id)
          .filter((id): id is number => id !== null);
        const owners = new Set(
          ownerIds.length === 0
            ? []
            : (
                await copy<
                  { id: number }[]
                >`SELECT id FROM users WHERE id IN ${copy(ownerIds)}`
              ).map((r) => r.id),
        );
        const orphans = kept.filter(
          (k) => k.owner_id === null || !owners.has(k.owner_id),
        );
        if (orphans.length > 0) {
          throw new Refusal(
            `kept API key(s) whose owner isn't in prod's users: ${orphans.map((k) => `#${k.id} "${k.name}" (owner ${k.owner_id ?? "none"})`).join(", ")}. ` +
              `Re-own them on staging to a user that exists in prod (UPDATE api_keys SET owner_id = <id> WHERE id = <key id>) and run again.`,
          );
        }
        log(
          `   keeping ${kp.keep.length} of ${stashed.length} stashed API key(s)`,
        );
        return { keep: kp.keep, stashedCount: stashed.length };
      },
    );

    savedFks = await foreignKeys(stg);
    if (await hasSchema(stg, FK_STASH)) {
      // --reuse-existing-stash after a failed rollback: the FKs it dropped
      // are only in the stash now.
      savedFks = mergeFks(await stashedFks(stg), savedFks);
      log(`   merged the FKs saved in the existing ${FK_STASH}`);
    } else {
      stashedHere.push(FK_STASH);
    }
    await stashFks(stg, savedFks);
    log(`   ${savedFks.length} foreign keys saved`);

    // ---- 8. wipe -----------------------------------------------------------------
    await step(
      `8/12 drop ${savedFks.length} FKs + truncate ${load.length} tables (one transaction)`,
      async () => {
        await dropFksAndTruncate(stg, savedFks, load);
        wiped = true;
      },
    );

    // ---- 9. load + put staging's own rows back -------------------------------------
    let slackResult = "";
    try {
      await step(
        "9/12 load the obfuscated data, restore staging's keys and Slack rows",
        async () => {
          await pgTool(
            "pg_restore",
            [
              "--data-only",
              "--no-owner",
              "--no-privileges",
              "--single-transaction",
              "--exit-on-error",
              "-d",
              ctx.stagingDb,
              files.loadDump,
            ],
            ctx.stagingUrl,
            { pgoptions: "-c app.disable_ao_count_trigger=true" },
          );
          const loaded = await rowCounts(stg, load);
          const off = load.filter((t) => loaded.get(t) !== counts.get(t));
          if (off.length > 0) {
            throw new Error(
              `row counts differ from the copy: ${off.map((t) => `${t} ${loaded.get(t)} vs ${counts.get(t)}`).join(", ")}`,
            );
          }
          log(`   row counts match the copy for all ${load.length} tables`);

          await addFksNotValid(stg, savedFks);
          const now = await foreignKeys(stg);
          if (now.length !== savedFks.length) {
            throw new Error(
              `${now.length} FKs after re-adding, expected ${savedFks.length}`,
            );
          }
          log(`   ${savedFks.length} FKs back (NOT VALID)`);

          if (keepPlan.keep.length > 0) {
            const res = await runScript(
              "staging-api-keys",
              [
                "--allow-db",
                ctx.stagingDb,
                "--restore",
                ...keepPlan.keep.flatMap((n) => ["--keep", n]),
              ],
              ctx.stagingUrl,
            );
            if (res.code !== 0)
              throw new Error("staging-api-keys --restore failed");
          } else {
            warn("no API keys to keep; dropping the stash");
            await stg`DROP SCHEMA refresh_keep CASCADE`;
          }
          const slack = await runScript(
            "staging-slack",
            ["--allow-db", ctx.stagingDb, "--restore"],
            ctx.stagingUrl,
          );
          if (slack.code !== 0)
            throw new Error("staging-slack --restore failed");
          slackResult = slack.stdout.trim();

          log(`   ${await resetSequences(stg)} sequences reset to max(id)`);
          for (const t of load) await stg.unsafe(`ANALYZE ${quoteTable(t)}`);
          log(`   analyzed ${load.length} tables`);
        },
      );
      // The FKs are back: their saved definitions aren't needed any more.
      await stg.unsafe(`DROP SCHEMA IF EXISTS ${FK_STASH} CASCADE`);
    } catch (error) {
      log(`\n!! LOAD FAILED: ${errMsg(error)}`);
      const restored = await rollback(
        ctx,
        files.backup,
        files.toc,
        load,
        savedFks,
        stashedHere,
      );
      if (!restored) return 2;
      log(
        "\nSTAGING REFRESH FAILED — staging was rolled back to its data from before the run.",
      );
      return 1;
    }

    // ---- 10. slackbot ------------------------------------------------------------
    const slackbot = await step(
      "10/12 restart the staging slackbot",
      async () => {
        const r = await restartSlackbot();
        log(`   ${r}`);
        return r;
      },
    );

    // ---- 11. validate FKs ------------------------------------------------------------
    const toValidate = savedFks.filter((fk) => fk.validated);
    const validation = await step(
      `11/12 validate ${toValidate.length} FKs, one at a time`,
      () => validateFks(stg, toValidate),
    );

    // ---- 12. summary -------------------------------------------------------------------
    const problems: string[] = [];
    const preservedAfter = new Map<string, string>();
    for (const t of plan?.preserved ?? []) {
      const h = await tableHash(stg, t);
      preservedAfter.set(t, h);
      if (h !== preservedBefore.get(t))
        problems.push(`preserved table ${t} changed during the run`);
    }
    if (validation.validated !== toValidate.length) {
      problems.push(
        `${validation.failed.length} of ${toValidate.length} FKs could not be validated (they stay NOT VALID, still enforced for new rows): ${validation.failed.join("; ")}`,
      );
    }
    printSummary({
      ctx,
      plan,
      counts,
      dryRun: false,
      staging: await rowCounts(
        stg,
        [
          "public.users",
          "public.attendance",
          "public.event_instances",
          "public.orgs",
          "public.api_keys",
        ].filter((t) => load.includes(t)),
      ),
      keys: `${keepPlan.keep.length} kept of ${keepPlan.stashedCount} stashed (${keepPlan.keep.join(", ")})`,
      slack: slackResult,
      slackbot,
      clientIds: await preservedClientIds(stg),
      preservedBefore,
      preservedAfter,
      fks: `${validation.validated}/${toValidate.length} validated${savedFks.length > toValidate.length ? ` (${savedFks.length - toValidate.length} were NOT VALID before the run and stay so)` : ""}`,
    });
    if (problems.length > 0) {
      log(
        `\nSTAGING REFRESH FINISHED WITH PROBLEMS — staging has the new data, but:\n - ${problems.join("\n - ")}`,
      );
      return 1;
    }
    log("\nSTAGING REFRESH: OK");
    return 0;
  } catch (error) {
    const msg = errMsg(error);
    if (wiped) {
      // Only reachable if something after step 9 threw unexpectedly.
      log(`\n!! FAILED after staging was loaded: ${msg}`);
      return 1;
    }
    log(`\n!! STOPPED: ${msg}`);
    if (!(error instanceof Refusal) && error instanceof Error && error.stack)
      log(error.stack);
    for (const schema of stashedHere) {
      // Only what this run created; the backup was never needed.
      await stg
        .unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        .catch(() => undefined);
      log(`   dropped this run's ${schema}`);
    }
    log("\nSTAGING REFRESH FAILED — staging was not changed.");
    return 1;
  } finally {
    await Promise.all(
      [prod.end(), copy.end(), stg.end()].map((p) => p.catch(() => undefined)),
    );
    rmSync(ctx.work, { recursive: true, force: true });
    log(`\n(temp files removed; total ${minutes(Date.now() - startedAt)})`);
  }
}

/** Client ids (public identifiers, never secrets) in the preserved tables. */
async function preservedClientIds(sql: Sql): Promise<string> {
  const parts: string[] = [];
  for (const t of PRESERVED_TABLES) {
    const [present] = await sql<
      { ok: boolean }[]
    >`SELECT to_regclass(${t}) IS NOT NULL AS ok`;
    if (!present?.ok) continue;
    const rows = await sql.unsafe<{ id: string }[]>(
      `SELECT id::text AS id FROM ${quoteTable(t)} ORDER BY 1`,
    );
    parts.push(`${t}: ${rows.map((r) => r.id).join(", ") || "(empty)"}`);
  }
  return parts.length > 0 ? parts.join("; ") : "none";
}

/**
 * Put staging's load set back exactly as the backup has it. Runs after any
 * failure once the truncate committed.
 */
async function rollback(
  ctx: Context,
  backup: string,
  tocFile: string,
  load: string[],
  savedFks: ForeignKey[],
  stashedHere: string[],
): Promise<boolean> {
  log(
    "\n== ROLLBACK: restoring staging's load set from the backup taken before the load",
  );
  // If the failure came after staging-api-keys / staging-slack had already
  // put their rows back (and dropped their stash), stash those rows again
  // first: the backup file dies with this container, so if the rollback
  // can't finish, the stash is what --reuse-existing-stash recovers from.
  for (const [kind, script] of [
    ["keys", "staging-api-keys"],
    ["slack", "staging-slack"],
  ] as const) {
    const schema = STASH_SCHEMAS[kind];
    const probe = connect(ctx.stagingUrl);
    try {
      if (!(await hasSchema(probe, schema))) {
        const res = await runScript(
          script,
          ["--allow-db", ctx.stagingDb, "--stash"],
          ctx.stagingUrl,
        );
        log(`   re-stashed ${schema}: ${res.code === 0 ? "ok" : "FAILED"}`);
      }
    } catch (error) {
      log(`   could not check ${schema}: ${errMsg(error)}`);
    } finally {
      await probe.end().catch(() => undefined);
    }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sql = connect(ctx.stagingUrl);
    try {
      // Whatever FKs exist right now (the failure may have come before or
      // after they were re-added), then the same truncate.
      const current = await foreignKeys(sql);
      await dropFksAndTruncate(sql, current, load);
      await pgTool("pg_restore", ["-l", "-f", tocFile, backup], ctx.stagingUrl);
      const listFile = `${tocFile}.rollback`;
      writeFileSync(
        listFile,
        `${filterToc(readFileSync(tocFile, "utf8"), load).join("\n")}\n`,
      );
      await pgTool(
        "pg_restore",
        [
          "--data-only",
          "--no-owner",
          "--no-privileges",
          "--single-transaction",
          "--exit-on-error",
          "-L",
          listFile,
          "-d",
          ctx.stagingDb,
          backup,
        ],
        ctx.stagingUrl,
        { pgoptions: "-c app.disable_ao_count_trigger=true" },
      );
      log(`   ${load.length} tables restored from the backup`);
      const readded = await addMissingFks(sql, savedFks);
      log(`   ${readded} FKs re-added (NOT VALID), ${savedFks.length} in all`);
      // The backup was taken before the stash, so it already holds staging's
      // own API keys and Slack rows.
      for (const schema of stashedHere) {
        await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        log(`   dropped ${schema} (the backup has those rows)`);
      }
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${FK_STASH} CASCADE`);
      log(`   ${await resetSequences(sql)} sequences reset`);
      for (const t of load) await sql.unsafe(`ANALYZE ${quoteTable(t)}`);
      const toValidate = savedFks.filter((fk) => fk.validated);
      const v = await validateFks(sql, toValidate);
      log(`   ${v.validated}/${toValidate.length} FKs validated`);
      log("== ROLLBACK DONE");
      return true;
    } catch (error) {
      log(`   rollback attempt ${attempt}/3 failed: ${errMsg(error)}`);
      // Don't leave staging without its FKs between attempts (or after the
      // last one): the tables are empty or restored, so NOT VALID adds work.
      try {
        const n = await addMissingFks(sql, savedFks);
        if (n > 0) log(`   re-added ${n} FKs (NOT VALID) meanwhile`);
      } catch (e) {
        log(`   could not re-add FKs: ${errMsg(e)}`);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 10_000));
    } finally {
      await sql.end().catch(() => undefined);
    }
  }
  log(
    "\n!!! ROLLBACK FAILED. Staging's loaded tables may be empty or half-loaded.\n" +
      "!!! Staging's own API keys, Slack rows and FK definitions are still in the refresh_keep,\n" +
      "!!! refresh_keep_slack and refresh_keep_fks schemas on staging. Re-run the job with\n" +
      "!!! --reuse-existing-stash to load a fresh copy and put them back:\n" +
      "!!!   gcloud run jobs execute f3-staging-refresh --project f3data --region us-central1 --wait --args=--reuse-existing-stash",
  );
  log("\nSTAGING REFRESH FAILED — and the rollback failed (see above).");
  return false;
}

function printSummary(s: {
  ctx: Context;
  plan: LoadPlan | undefined;
  counts: Map<string, number>;
  dryRun: boolean;
  staging?: Map<string, number>;
  keys?: string;
  slack?: string;
  slackbot?: string;
  clientIds?: string;
  preservedBefore?: Map<string, string>;
  preservedAfter?: Map<string, string>;
  fks?: string;
}): void {
  log("\n================ SUMMARY ================");
  const pick = (m: Map<string, number> | undefined, t: string) =>
    m?.get(t) ?? "-";
  log("rows (copy -> staging):");
  for (const t of [
    "public.users",
    "public.attendance",
    "public.event_instances",
    "public.orgs",
  ]) {
    log(
      `   ${t.padEnd(24)} ${String(pick(s.counts, t)).padStart(10)}  ${s.dryRun ? "" : String(pick(s.staging, t)).padStart(10)}`,
    );
  }
  log(`loaded tables: ${s.plan?.load.length ?? 0}`);
  log(`preserved (untouched): ${listOrNone(s.plan?.preserved ?? [])}`);
  if (s.plan?.copyOnly.length)
    log(`skipped, not on staging: ${s.plan.copyOnly.join(", ")}`);
  if (s.plan?.stagingOnly.length)
    log(`left alone, staging only: ${s.plan.stagingOnly.join(", ")}`);
  if (s.keys) log(`API keys: ${s.keys}`);
  if (s.slack) log(`Slack: ${s.slack.replace(/\n/g, "\n   ")}`);
  if (s.slackbot) log(`slackbot: ${s.slackbot}`);
  if (s.clientIds) log(`client registrations on staging: ${s.clientIds}`);
  for (const [t, before] of s.preservedBefore ?? []) {
    const after = s.preservedAfter?.get(t);
    if (after !== undefined)
      // Row count only: the hash covers secret hashes too.
      log(
        `   ${t} ${after === before ? "unchanged" : "CHANGED"} (${after.split(",")[0]})`,
      );
  }
  if (s.fks) log(`foreign keys: ${s.fks}`);
  if (warnings.length > 0) log(`warnings:\n   - ${warnings.join("\n   - ")}`);
  log("timings:");
  for (const t of timings) log(`   ${minutes(t.ms).padStart(7)}  ${t.step}`);
}

process.on("SIGTERM", () => {
  log(
    "\n!!! SIGTERM (task timeout?). If this hit after step 8, staging may be half-loaded; " +
      "re-run with --reuse-existing-stash if refresh_keep schemas are left on staging.",
  );
  process.exit(143);
});

main().then(
  (code) => {
    process.exitCode = process.exitCode ?? code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
