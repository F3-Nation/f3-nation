import { and, eq } from 'drizzle-orm';

import { db } from '../drizzle/db';
import {
  regions as regionsSchema,
  workouts as workoutsSchema,
} from '../drizzle/schema';
import { getDb as getF3DataWarehouseDb } from '../drizzle/f3-data-warehouse/db';
import {
  events as eventsSchema,
  orgs as orgsSchema,
} from '../drizzle/f3-data-warehouse/schema';

export async function pruneWorkouts() {
  console.debug('🔄 pruning workouts no longer in the warehouse...');

  const f3DataWarehouseDb = await getF3DataWarehouseDb();
  const activeWarehouseWorkouts = await f3DataWarehouseDb
    .select({
      id: eventsSchema.id,
    })
    .from(eventsSchema)
    .innerJoin(orgsSchema, eq(eventsSchema.orgId, orgsSchema.id))
    .where(
      and(
        eq(eventsSchema.isActive, true),
        eq(orgsSchema.isActive, true),
        eq(orgsSchema.orgType, 'ao')
      )
    );
  const activeWorkoutIds = new Set(
    activeWarehouseWorkouts.map((workout) => workout.id.toString())
  );

  const supabaseRegions = await db
    .select({ id: regionsSchema.id, name: regionsSchema.name })
    .from(regionsSchema);
  const supabaseRegionIds = new Set(supabaseRegions.map((region) => region.id));
  const regionNameById = new Map(
    supabaseRegions.map((region) => [region.id, region.name])
  );

  const supabaseWorkouts = await db
    .select({
      id: workoutsSchema.id,
      name: workoutsSchema.name,
      regionId: workoutsSchema.regionId,
    })
    .from(workoutsSchema);

  let removed = 0;
  const workouts: { name: string; regionName: string }[] = [];
  for (const workout of supabaseWorkouts) {
    const missingFromWarehouse = !activeWorkoutIds.has(workout.id);
    const missingRegion = workout.regionId
      ? !supabaseRegionIds.has(workout.regionId)
      : true;

    if (!missingFromWarehouse && !missingRegion) continue;

    console.debug(
      `removing workout ${workout.name} (${workout.id})` +
        (missingRegion
          ? ' because region is missing'
          : ' because it is not active in warehouse')
    );
    await db.delete(workoutsSchema).where(eq(workoutsSchema.id, workout.id));
    removed++;
    workouts.push({
      name: workout.name,
      regionName: workout.regionId
        ? regionNameById.get(workout.regionId) ?? ''
        : '',
    });
  }

  console.debug(`✅ pruned ${removed} workout(s)`);
  return { removed, workouts };
}

if (import.meta.main) {
  await pruneWorkouts();
}
