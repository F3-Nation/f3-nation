import { and, eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";

export interface OrgIds {
  nationId: number;
  sectorIds: Record<string, number>;
  areaIds: Record<string, number>;
  regionIds: Record<string, number>;
  aoIds: Record<string, number>;
}

export async function findOrInsertOrg(
  db: AppDb,
  values: typeof schema.orgs.$inferInsert & { parentId: number },
  label: string,
): Promise<number> {
  const [existing] = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(
      and(
        eq(schema.orgs.name, values.name),
        eq(schema.orgs.orgType, values.orgType),
        eq(schema.orgs.parentId, values.parentId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [inserted] = await db
    .insert(schema.orgs)
    .values(values)
    .returning({ id: schema.orgs.id });

  console.log(`  + Inserted ${label}: ${values.name}`);
  return inserted!.id;
}
