import { eq, and } from 'drizzle-orm';

import { db } from '../drizzle/db';
import {
  regions as regionsSchema,
  workouts as workoutsSchema,
} from '../drizzle/schema';
import { db as f3DataWarehouseDb } from '../drizzle/f3-data-warehouse/db';
import { orgs as orgsSchema } from '../drizzle/f3-data-warehouse/schema';

export async function pruneRegions() {
  console.debug('🔄 pruning regions no longer in the warehouse...');

  const activeWarehouseRegions = await f3DataWarehouseDb
    .select({
      id: orgsSchema.id,
    })
    .from(orgsSchema)
    .where(
      and(eq(orgsSchema.orgType, 'region'), eq(orgsSchema.isActive, true))
    );
  const activeRegionIds = new Set(
    activeWarehouseRegions.map((region) => region.id.toString())
  );

  const supabaseRegions = await db
    .select({
      id: regionsSchema.id,
      name: regionsSchema.name,
    })
    .from(regionsSchema);

  let removed = 0;
  for (const region of supabaseRegions) {
    if (activeRegionIds.has(region.id)) continue;

    console.debug(`removing region ${region.name} (${region.id})`);
    await db
      .delete(workoutsSchema)
      .where(eq(workoutsSchema.regionId, region.id));
    await db.delete(regionsSchema).where(eq(regionsSchema.id, region.id));
    removed++;
  }

  console.debug(`✅ pruned ${removed} region(s)`);
}

const importMeta = import.meta as ImportMeta & { main?: boolean };

if (importMeta.main) {
  await pruneRegions();
}
