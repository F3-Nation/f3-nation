/**
 * One-off data fix: convert legacy pending `edit` update-requests to the new
 * per-action request types so they can be reviewed in the new admin UI.
 *
 * Background: the old map flow recorded a single `edit` request type holding
 * event + AO + location fields in the same flat columns the new types use.
 * The new admin UI has no form for `edit` (it prompts reject/resubmit), so
 * pending rows would be stuck. This script reclassifies them:
 *
 *   - event_id set, no ao/location edit target → edit_event
 *   - ao_id/location_id set, no event target   → edit_ao_and_location
 *   - both targets                              → reported only (use --split
 *     to convert to an edit_ao_and_location row plus a linked edit_event row)
 *   - no targets                                → reported for manual triage
 *
 * It also backfills meta.originalEventId / originalAoId / originalLocationId /
 * originalRegionId from the row's columns, which the new admin forms read for
 * prefill. Only rows with status='pending' AND request_type='edit' are
 * touched; converted rows get meta.convertedFrom='edit' so reruns skip them.
 *
 * Usage (dry-run by default; nothing is written without --apply):
 *   DATABASE_URL=postgres://… pnpm with-env node -r esbuild-register \
 *     src/convert-legacy-edit-requests.ts -- --expect-db <dbname> [--apply] [--split]
 *
 * Safety: --expect-db must match the database name in DATABASE_URL exactly,
 * so a stale env can't silently point the script at the wrong database.
 */
import { randomUUID } from "crypto";

import { sql } from "drizzle-orm";

import { db } from "./client";
import { getDbUrl } from "./utils/functions";

interface LegacyRow {
  id: string;
  event_id: number | null;
  ao_id: number | null;
  location_id: number | null;
  region_id: number | null;
  meta: Record<string, unknown> | null;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const split = args.includes("--split");
const expectDbIdx = args.indexOf("--expect-db");
const expectDb = expectDbIdx >= 0 ? args[expectDbIdx + 1] : undefined;

const classify = (
  row: LegacyRow,
): "edit_event" | "edit_ao_and_location" | "both" | "unclassifiable" => {
  const hasEvent = row.event_id != null;
  const hasAoOrLocation = row.ao_id != null || row.location_id != null;
  if (hasEvent && hasAoOrLocation) return "both";
  if (hasEvent) return "edit_event";
  if (hasAoOrLocation) return "edit_ao_and_location";
  return "unclassifiable";
};

const buildMeta = (row: LegacyRow): Record<string, unknown> => ({
  ...(row.meta ?? {}),
  ...(row.event_id != null && { originalEventId: row.event_id }),
  ...(row.ao_id != null && { originalAoId: row.ao_id }),
  ...(row.location_id != null && { originalLocationId: row.location_id }),
  ...(row.region_id != null && { originalRegionId: row.region_id }),
  convertedFrom: "edit",
  convertedAt: new Date().toISOString(),
});

const main = async () => {
  const { databaseName } = getDbUrl();
  if (!expectDb) {
    throw new Error(
      "Pass --expect-db <dbname> matching the DATABASE_URL database name",
    );
  }
  if (expectDb !== databaseName) {
    throw new Error(
      `--expect-db "${expectDb}" does not match DATABASE_URL database "${databaseName}" — refusing to run`,
    );
  }

  // postgres-js: execute() resolves to the row list itself
  const rows = (await db.execute(sql`
    SELECT id, event_id, ao_id, location_id, region_id, meta
    FROM update_requests
    WHERE status = 'pending'
      AND request_type = 'edit'
      AND (meta IS NULL OR meta->>'convertedFrom' IS NULL)
    ORDER BY created
  `)) as unknown as LegacyRow[];

  console.log(
    `${apply ? "APPLY" : "DRY RUN"} — ${rows.length} pending legacy 'edit' request(s) on "${databaseName}"\n`,
  );

  const counts = {
    edit_event: 0,
    edit_ao_and_location: 0,
    both: 0,
    unclassifiable: 0,
  };

  for (const row of rows) {
    const kind = classify(row);
    counts[kind]++;
    const ids = `event_id=${row.event_id} ao_id=${row.ao_id} location_id=${row.location_id} region_id=${row.region_id}`;

    if (kind === "unclassifiable") {
      console.log(`SKIP  ${row.id}  no target ids (${ids}) — triage manually`);
      continue;
    }

    if (kind === "both" && !split) {
      console.log(
        `SKIP  ${row.id}  touches event AND ao/location (${ids}) — rerun with --split or triage manually`,
      );
      continue;
    }

    if (kind === "both") {
      // --split: original row becomes the AO/location edit; a linked copy
      // carries the event edit. Both keep every field column, so each new
      // form simply reads the subset it renders.
      const meta = buildMeta(row);
      console.log(
        `SPLIT ${row.id}  -> edit_ao_and_location + new edit_event row (${ids})`,
      );
      if (apply) {
        await db.transaction(async (tx) => {
          const newId = randomUUID();
          await tx.execute(sql`
            UPDATE update_requests
            SET request_type = 'edit_ao_and_location',
                meta = ${JSON.stringify({ ...meta, splitSiblingId: newId })}::jsonb
            WHERE id = ${row.id}
          `);
          await tx.execute(sql`
            INSERT INTO update_requests
              (id, token, region_id, event_id, event_name, event_description,
               event_start_time, event_end_time, event_day_of_week,
               event_type_ids, ao_id, location_id, submitted_by, status,
               request_type, meta, created)
            SELECT ${newId}, gen_random_uuid(), region_id, event_id, event_name,
               event_description, event_start_time, event_end_time,
               event_day_of_week, event_type_ids, ao_id, location_id,
               submitted_by, status, 'edit_event',
               ${JSON.stringify({ ...meta, splitFromId: row.id })}::jsonb, created
            FROM update_requests WHERE id = ${row.id}
          `);
        });
      }
      continue;
    }

    console.log(`CONV  ${row.id}  -> ${kind} (${ids})`);
    if (apply) {
      await db.execute(sql`
        UPDATE update_requests
        SET request_type = ${kind}::request_type,
            meta = ${JSON.stringify(buildMeta(row))}::jsonb
        WHERE id = ${row.id} AND status = 'pending' AND request_type = 'edit'
      `);
    }
  }

  console.log(
    `\nSummary: ${counts.edit_event} edit_event, ${counts.edit_ao_and_location} edit_ao_and_location, ${counts.both} both${split ? " (split)" : " (skipped — needs --split)"}, ${counts.unclassifiable} unclassifiable`,
  );
  if (!apply) console.log("Dry run — rerun with --apply to write.");
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
