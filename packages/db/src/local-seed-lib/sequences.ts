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
}
