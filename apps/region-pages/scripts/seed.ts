import { enrichRegions } from './enrich-regions';
import { seedRegions } from './seed-regions';
import { seedWorkouts } from './seed-workouts';

async function main() {
  await seedRegions();
  await seedWorkouts();
  await enrichRegions();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ seed failed', error);
    process.exit(1);
  });
}
