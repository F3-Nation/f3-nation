/**
 * staging-refresh.ts --snapshot-only: cut the developer snapshot from the
 * refresh's obfuscated, verify-target-passed copy (docs/STAGING_REFRESH.md).
 *
 * Nothing here obfuscates or classifies data. The copy is trimmed in place
 * to SNAPSHOT_TABLES (staging-refresh.config.ts), scanned again with
 * verify-target's own checks, then dumped data-only with a manifest into one
 * tar file. Only publishSnapshot hands that file on, and only after the scan.
 */
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type postgres from "postgres";

import { quoteIdent } from "./db-url";
import {
  readColumnSnapshot,
  readTargetColumns,
  unreviewedColumns,
} from "./obfuscate-db.columns";
import type { FkEdge } from "./staging-refresh.checks";
import { fkEdges, filterToc, quoteTable } from "./staging-refresh.checks";
import {
  SNAPSHOT_EMAIL_SINK,
  SNAPSHOT_OBJECT,
  SNAPSHOT_REQUIRED_TABLES,
  SNAPSHOT_TABLES,
  SNAPSHOT_WINDOW,
} from "./staging-refresh.config";
import {
  baseEnv,
  log,
  metadataToken,
  pgTool,
  run,
  runScript,
} from "./staging-refresh.proc";

type Sql = postgres.Sql;

/** Bumped when the tar's layout or the manifest's shape changes. */
const SNAPSHOT_FORMAT_VERSION = 1;

/** Emptied by the trim: everything verify-target sweeps, plus history. */
const TRIM_SCHEMAS = ["public", "auth", "slackbot"];

export interface TrimResult {
  emptied: number;
  instancesKept: number;
  instancesDropped: number;
  privateSeriesDropped: number;
  privateLocationsDropped: number;
  linkRowsDropped: number;
  window: { from: string; to: string };
}

export interface SnapshotManifest {
  formatVersion: number;
  exportedAt: string;
  migration: { tag: string; createdAt: number };
  window: { from: string; to: string };
  tables: Record<string, { rows: number; columns: string[] }>;
}

const tableOf = (entry: string) =>
  entry.slice(0, entry.indexOf(":")).split(".").slice(0, 2).join(".");

/**
 * Fail closed: every kept table must exist, and every column it has must be
 * one obfuscate-db was reviewed against.
 */
export async function assertSnapshotColumnsReviewed(sql: Sql): Promise<void> {
  const kept = (await readTargetColumns(sql)).filter((e) =>
    SNAPSHOT_TABLES.includes(tableOf(e)),
  );
  const present = new Set(kept.map(tableOf));
  const missing = SNAPSHOT_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(`snapshot table(s) not in the copy: ${missing.join(", ")}`);
  }
  const unreviewed = unreviewedColumns(kept, readColumnSnapshot());
  if (unreviewed.length > 0) {
    throw new Error(
      `snapshot table column(s) not in obfuscate-db.columns.txt: ${unreviewed.join(", ")}`,
    );
  }
}

/** FKs from kept tables into `ref`, each a single column onto its id. */
async function linksInto(sql: Sql, ref: string): Promise<FkEdge[]> {
  const links = (await fkEdges(sql, ["public"])).filter(
    (e) => e.refTable === ref && SNAPSHOT_TABLES.includes(e.table),
  );
  for (const e of links) {
    if (e.columns.length !== 1 || e.refColumns[0] !== "id") {
      throw new Error(`unexpected FK ${e.name} into ${ref}`);
    }
  }
  return links;
}

/**
 * Trim the (throwaway) copy in place, in one transaction: empty every table
 * outside SNAPSHOT_TABLES, drop private event series and instances, keep
 * only event_instances inside SNAPSHOT_WINDOW (and their link rows), drop
 * locations only private events use, their blasts and users' free-text
 * profile answers, then empty the history the audit triggers just wrote.
 */
export async function trimSnapshot(sql: Sql): Promise<TrimResult> {
  const links = await linksInto(sql, "public.event_instances");
  // event_instances rows go with the instances below; events.series_id rows
  // are themselves in the private set.
  const seriesLinks = (await linksInto(sql, "public.events")).filter(
    (e) => e.table !== "public.event_instances" && e.table !== "public.events",
  );
  return sql.begin(async (tx) => {
    const tables = (
      await tx<{ t: string; s: string }[]>`
        SELECT n.nspname || '.' || c.relname AS t, n.nspname AS s
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND n.nspname = ANY(${[...TRIM_SCHEMAS, "public_history"]})
        ORDER BY 1`
    ).filter((r) => !SNAPSHOT_TABLES.includes(r.t));
    const excluded = tables.filter((r) => r.s !== "public_history");
    const history = tables.filter((r) => r.s === "public_history");

    // No CASCADE: Postgres refuses if a kept table has an FK into one of
    // these, which the published file could not satisfy.
    if (excluded.length > 0) {
      await tx.unsafe(
        `TRUNCATE TABLE ${excluded.map((r) => quoteTable(r.t)).join(", ")}`,
      );
    }

    const [win] = await tx<{ from: string; to: string }[]>`
      SELECT (current_date - ${SNAPSHOT_WINDOW.daysBack}::int)::text AS from,
        (current_date + ${SNAPSHOT_WINDOW.daysAhead}::int)::text AS to`;
    if (!win) throw new Error("could not compute the event_instances window");
    // A series under a private series is private too.
    await tx`
      CREATE TEMP TABLE snapshot_private_series ON COMMIT DROP AS
      WITH RECURSIVE p AS (
        SELECT id FROM public.events WHERE is_private
        UNION SELECT e.id FROM public.events e JOIN p ON e.series_id = p.id
      ) SELECT id FROM p`;
    const privateSeries = "SELECT id FROM snapshot_private_series";
    // Independently remove locations used only by effectively private rows,
    // even when the input has not had obfuscate-db's location cleanup.
    await tx.unsafe(`
      CREATE TEMP TABLE snapshot_private_locations ON COMMIT DROP AS
      SELECT location_id AS id FROM public.events
        WHERE id IN (${privateSeries}) AND location_id IS NOT NULL
      UNION SELECT location_id FROM public.event_instances
        WHERE (is_private OR series_id IN (${privateSeries}))
          AND location_id IS NOT NULL
      EXCEPT (
        SELECT location_id FROM public.events
          WHERE id NOT IN (${privateSeries}) AND location_id IS NOT NULL
        UNION SELECT location_id FROM public.event_instances
          WHERE NOT is_private AND location_id IS NOT NULL
            AND (series_id IS NULL OR series_id NOT IN (${privateSeries}))
      )`);
    const privateLocations = "SELECT id FROM snapshot_private_locations";
    const outside = `SELECT id FROM public.event_instances
      WHERE start_date IS NULL OR start_date NOT BETWEEN '${win.from}'::date AND '${win.to}'::date
        OR is_private OR series_id IN (${privateSeries})`;

    let linkRowsDropped = 0;
    for (const e of links) {
      const res = await tx.unsafe(
        `DELETE FROM ${quoteTable(e.table)} WHERE ${quoteIdent(e.columns[0]!)} IN (${outside})`,
      );
      linkRowsDropped += res.count;
    }
    const dropped = await tx.unsafe(
      `DELETE FROM public.event_instances WHERE id IN (${outside})`,
    );
    for (const e of seriesLinks) {
      const res = await tx.unsafe(
        `DELETE FROM ${quoteTable(e.table)} WHERE ${quoteIdent(e.columns[0]!)} IN (${privateSeries})`,
      );
      linkRowsDropped += res.count;
    }
    const seriesDropped = await tx.unsafe(
      `DELETE FROM public.events WHERE id IN (${privateSeries})`,
    );
    // No FK, so nothing stops a dangling default; any FK'd reference left
    // over makes the DELETE fail instead.
    const defaults = await tx.unsafe(
      `UPDATE public.orgs SET default_location_id = NULL
      WHERE default_location_id IN (${privateLocations})`,
    );
    linkRowsDropped += defaults.count;
    const locationsDropped = await tx.unsafe(
      `DELETE FROM public.locations WHERE id IN (${privateLocations})`,
    );
    await tx`
      UPDATE public.event_instances SET preblast = NULL, backblast = NULL,
        preblast_rich = NULL, backblast_rich = NULL`;
    // obfuscate-db only scrubs emails and phones in it; the profile answers
    // (my_f3_why, f3_name_origin, …) are free text.
    await tx`UPDATE public.users SET meta = NULL WHERE meta IS NOT NULL`;
    const [kept] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.event_instances`;

    if (history.length > 0) {
      await tx.unsafe(
        `TRUNCATE TABLE ${history.map((r) => quoteTable(r.t)).join(", ")}`,
      );
    }
    return {
      emptied: excluded.length,
      instancesKept: kept?.n ?? 0,
      instancesDropped: dropped.count,
      privateSeriesDropped: seriesDropped.count,
      privateLocationsDropped: locationsDropped.count,
      linkRowsDropped,
      window: { from: win.from, to: win.to },
    };
  });
}

/** verify-target on the trimmed copy, against the snapshot's sink. */
export async function leakScan(copyUrl: string): Promise<boolean> {
  const res = await runScript(
    "obfuscate-db.verify-target",
    [`--email-sink=${SNAPSHOT_EMAIL_SINK}`],
    copyUrl,
  );
  return res.code === 0 && /ALL \d+ CHECKS PASSED/.test(res.stdout);
}

async function describeTables(sql: Sql): Promise<SnapshotManifest["tables"]> {
  const out: SnapshotManifest["tables"] = {};
  for (const t of SNAPSHOT_TABLES) {
    const cols = await sql<{ col: string }[]>`
      SELECT attname::text AS col FROM pg_attribute
      WHERE attrelid = ${quoteTable(t)}::regclass AND attnum > 0 AND NOT attisdropped
      ORDER BY attnum`;
    const [row] = await sql.unsafe<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM ${quoteTable(t)}`,
    );
    out[t] = { rows: Number(row?.n ?? 0), columns: cols.map((c) => c.col) };
  }
  return out;
}

/**
 * Leak scan, row floor, then dump + manifest + tar, then `deliver`. Throws
 * before anything is built or delivered if either check fails.
 */
export async function publishSnapshot(opts: {
  sql: Sql;
  copyUrl: string;
  work: string;
  migration: SnapshotManifest["migration"];
  window: SnapshotManifest["window"];
  deliver: (file: string) => Promise<string>;
}): Promise<SnapshotManifest> {
  if (!(await leakScan(opts.copyUrl))) {
    throw new Error("leak scan did not pass (see above); nothing published.");
  }
  const tables = await describeTables(opts.sql);
  for (const t of SNAPSHOT_REQUIRED_TABLES) {
    if (!tables[t]?.rows) {
      throw new Error(`snapshot table ${t} has 0 rows; nothing published.`);
    }
  }

  const dump = path.join(opts.work, "snapshot.dump");
  const toc = path.join(opts.work, "snapshot.toc");
  await pgTool(
    "pg_dump",
    [
      "--data-only",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      ...SNAPSHOT_TABLES.flatMap((t) => ["-t", quoteTable(t)]),
      "-f",
      dump,
    ],
    opts.copyUrl,
    { quietStderr: /circular|foreign-key|detail:|hint:|--disable-triggers/i },
  );
  await pgTool("pg_restore", ["-l", "-f", toc, dump], opts.copyUrl);
  const entries = filterToc(readFileSync(toc, "utf8"), SNAPSHOT_TABLES).filter(
    (l) => l.includes(" TABLE DATA "),
  );
  if (entries.length !== SNAPSHOT_TABLES.length) {
    throw new Error(
      `snapshot dump holds ${entries.length} tables, expected ${SNAPSHOT_TABLES.length}`,
    );
  }

  const manifest: SnapshotManifest = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    migration: opts.migration,
    window: opts.window,
    tables,
  };
  writeFileSync(
    path.join(opts.work, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const tar = path.join(opts.work, path.basename(SNAPSHOT_OBJECT.name));
  const packed = await run(
    "tar",
    ["-cf", tar, "-C", opts.work, "manifest.json", "snapshot.dump"],
    { env: baseEnv() },
  );
  if (packed.code !== 0) throw new Error(`tar exited with ${packed.code}`);
  log(
    `   ${path.basename(tar)}: ${statSync(tar).size} bytes, ${entries.length} tables`,
  );

  log(`   ${await opts.deliver(tar)}`);
  return manifest;
}

/** What a snapshot run has handed on so far. */
export type DeliveryState = "none" | "in-flight" | "done";

/** For operators, when a run stops: whether the published file changed. */
export function deliveryOutcome(state: DeliveryState): string {
  switch (state) {
    case "none":
      return "Nothing was published.";
    case "in-flight":
      return "Stopped while delivering: the previous snapshot may or may not have been replaced.";
    case "done":
      return "The new snapshot had already been delivered.";
  }
}

/**
 * `target`, reporting "in-flight" before it starts: a rejection after that
 * may come after the object was already replaced.
 */
export function trackDelivery(
  target: (file: string) => Promise<string>,
  onState: (state: DeliveryState) => void,
): (file: string) => Promise<string> {
  return async (file) => {
    onState("in-flight");
    const result = await target(file);
    onState("done");
    return result;
  };
}

/** --snapshot-out: copy the file there instead of publishing it. */
export function writeTo(out: string): (file: string) => Promise<string> {
  return (file) => {
    copyFileSync(file, out);
    return Promise.resolve(`written to ${out}`);
  };
}

/**
 * Upload to SNAPSHOT_OBJECT with the job's service account, in one
 * multipart request so the object never exists without its no-cache header
 * (the bucket is public and the path is reused every run).
 */
export async function uploadToGcs(file: string): Promise<string> {
  const { bucket, name } = SNAPSHOT_OBJECT;
  const token = await metadataToken();
  const boundary = `f3-snapshot-${Date.now()}`;
  const meta = JSON.stringify({
    name,
    contentType: "application/x-tar",
    cacheControl: "no-cache, max-age=0",
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/x-tar\r\n\r\n`,
    ),
    readFileSync(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=multipart`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(5 * 60_000),
    },
  );
  if (!res.ok) {
    throw new Error(
      `upload to gs://${bucket}/${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const obj = (await res.json()) as { size?: string; generation?: string };
  return `uploaded gs://${bucket}/${name} (${obj.size ?? "?"} bytes, generation ${obj.generation ?? "?"})`;
}
