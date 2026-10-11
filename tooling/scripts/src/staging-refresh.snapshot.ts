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
import { fkEdges, filterToc, quoteTable } from "./staging-refresh.checks";
import {
  SNAPSHOT_EMAIL_SINK,
  SNAPSHOT_OBJECT,
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

/**
 * Trim the (throwaway) copy in place, in one transaction: empty every table
 * outside SNAPSHOT_TABLES, keep only event_instances inside SNAPSHOT_WINDOW
 * (and their link rows), drop their blasts, then empty the history the
 * audit triggers just wrote.
 */
export async function trimSnapshot(sql: Sql): Promise<TrimResult> {
  const links = (await fkEdges(sql, ["public"])).filter(
    (e) =>
      e.refTable === "public.event_instances" &&
      SNAPSHOT_TABLES.includes(e.table),
  );
  for (const e of links) {
    if (e.columns.length !== 1 || e.refColumns[0] !== "id") {
      throw new Error(`unexpected FK ${e.name} into event_instances`);
    }
  }
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
    const outside = `SELECT id FROM public.event_instances
      WHERE start_date IS NULL OR start_date NOT BETWEEN '${win.from}'::date AND '${win.to}'::date`;

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
    await tx`
      UPDATE public.event_instances SET preblast = NULL, backblast = NULL,
        preblast_rich = NULL, backblast_rich = NULL`;
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
 * Leak scan, then dump + manifest + tar, then `deliver`. Throws before
 * anything is built or delivered if the scan doesn't pass.
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
    tables: await describeTables(opts.sql),
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
