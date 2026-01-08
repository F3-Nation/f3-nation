import { db } from '../drizzle/db';
import {
  workouts as workoutsSchema,
  regions as regionsSchema,
  seedRuns as seedRunsSchema,
} from '../drizzle/schema';

async function resetDatabase() {
  await db.delete(seedRunsSchema);
  await db.delete(workoutsSchema);
  await db.delete(regionsSchema);
}

resetDatabase();
