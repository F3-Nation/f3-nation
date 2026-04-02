import { eq } from 'drizzle-orm';

import { db } from '../drizzle/db';
import {
  regions as regionsSchema,
  workouts as workoutsSchema,
} from '../drizzle/schema';
import { getDb as getF3DataWarehouseDb } from '../drizzle/f3-data-warehouse/db';
import { events as eventsSchema } from '../drizzle/f3-data-warehouse/schema';

export async function pruneWorkouts() {
  console.debug('🔄 pruning workouts no longer in the warehouse...');

  const f3DataWarehouseDb = await getF3DataWarehouseDb();
  const activeWarehouseWorkouts = await f3DataWarehouseDb
    .select({
      id: eventsSchema.id,
    })
    .from(eventsSchema)
    .where(eq(eventsSchema.isActive, true));
  const activeWorkoutIds = new Set(
    activeWarehouseWorkouts.map((workout) => workout.id.toString())
  );

  const supabaseRegions = await db
    .select({ id: regionsSchema.id })
    .from(regionsSchema);
  const supabaseRegionIds = new Set(supabaseRegions.map((region) => region.id));

  const supabaseWorkouts = await db
    .select({
      id: workoutsSchema.id,
      name: workoutsSchema.name,
      regionId: workoutsSchema.regionId,
    })
    .from(workoutsSchema);

  let removed = 0;
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
  }

  console.debug(`✅ pruned ${removed} workout(s)`);
}

if (import.meta.main) {
  await pruneWorkouts();
}
