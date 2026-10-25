import { sql } from "..";
import { schema } from "..";
import type { AppDb } from "../client";

export async function resetSequences(db: AppDb): Promise<void> {
  const [maxOrgId] = await db
    .select({ max: sql<number>`max(${schema.orgs.id})` })
    .from(schema.orgs);
  const [maxLocationId] = await db
    .select({ max: sql<number>`max(${schema.locations.id})` })
    .from(schema.locations);
  const [maxEventId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.events.id}), 0)` })
    .from(schema.events);

  if (maxOrgId?.max) {
    await db.execute(sql`SELECT setval('orgs_id_seq', ${maxOrgId.max + 1})`);
  }
  if (maxLocationId?.max) {
    await db.execute(
      sql`SELECT setval('locations_id_seq', ${maxLocationId.max + 1})`,
    );
  }
  if (maxEventId?.max !== undefined && maxEventId.max > 0) {
    await db.execute(
      sql`SELECT setval('events_id_seq', ${maxEventId.max + 1})`,
    );
  }

  const [maxApiKeyId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.apiKeys.id}), 0)` })
    .from(schema.apiKeys);
  if (maxApiKeyId?.max !== undefined && maxApiKeyId.max > 0) {
    await db.execute(
      sql`SELECT setval('api_keys_id_seq', ${maxApiKeyId.max + 1})`,
    );
  }

  const [maxPositionId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.positions.id}), 0)` })
    .from(schema.positions);
  if (maxPositionId?.max !== undefined && maxPositionId.max > 0) {
    await db.execute(
      sql`SELECT setval('positions_id_seq', ${maxPositionId.max + 1})`,
    );
  }

  const [maxAttendanceTypeId] = await db
    .select({
      max: sql<number>`coalesce(max(${schema.attendanceTypes.id}), 0)`,
    })
    .from(schema.attendanceTypes);
  if (maxAttendanceTypeId?.max !== undefined && maxAttendanceTypeId.max > 0) {
    await db.execute(
      sql`SELECT setval('attendance_types_id_seq', ${maxAttendanceTypeId.max + 1})`,
    );
  }

  const [maxEventTagId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.eventTags.id}), 0)` })
    .from(schema.eventTags);
  if (maxEventTagId?.max !== undefined && maxEventTagId.max > 0) {
    await db.execute(
      sql`SELECT setval('event_tags_id_seq', ${maxEventTagId.max + 1})`,
    );
  }
}

/**
 * Sets every sequence owned by a `public` table column (serial or identity)
 * to the table's max id, or leaves it unused when the table is empty. Unlike
 * `resetSequences` this covers tables a restored dump fills (`users`,
 * `roles`, `event_instances`, ...), so it must run before anything inserts.
 */
export async function resetAllSequences(db: AppDb): Promise<number> {
  const owned = await db.execute<{
    seq: string;
    table_name: string;
    column_name: string;
  }>(sql`
    SELECT pg_get_serial_sequence(
             format('%I.%I', n.nspname, c.relname), a.attname) AS seq,
           c.relname AS table_name,
           a.attname AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
  `);

  let reset = 0;
  for (const { seq, table_name, column_name } of owned) {
    if (!seq) continue;
    await db.execute(sql`
      SELECT setval(
        ${seq}::regclass,
        coalesce(max(${sql.identifier(column_name)}), 1),
        max(${sql.identifier(column_name)}) IS NOT NULL
      ) FROM ${sql.identifier(table_name)}
    `);
    reset += 1;
  }
  return reset;
}
