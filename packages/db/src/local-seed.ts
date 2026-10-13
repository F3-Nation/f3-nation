/**
 * Local development seed script. Safe to re-run.
 * Run with: pnpm db:seed:local
 * To add data, extend the arrays in ./local-seed-lib/data.ts and re-run.
 */

import { db } from "./client";
import { seedAttendanceTypes } from "./local-seed-lib/attendance";
import { DEV_LOGIN_HINT } from "./local-seed-lib/data";
import { seedEventTags } from "./local-seed-lib/event-tags";
import {
  seedAoLocationsAndEvents,
  seedEventTypes,
} from "./local-seed-lib/events";
import { seedOrgHierarchy } from "./local-seed-lib/orgs";
import { seedPositions } from "./local-seed-lib/positions";
import { resetSequences } from "./local-seed-lib/sequences";
import {
  seedApiKeys,
  seedDevUsers,
  seedOAuthClients,
} from "./local-seed-lib/users";

async function seed() {
  console.log("Seeding local development database...");
  const { nationId, regionIds, aoIds } = await seedOrgHierarchy(db);
  await seedAttendanceTypes(db);
  const allEventTypes = await seedEventTypes(db);
  await seedEventTags(db);
  await seedAoLocationsAndEvents(db, aoIds, regionIds, allEventTypes);
  const { adminUserId, roleIds } = await seedDevUsers(db, nationId);
  await seedApiKeys(db, adminUserId, nationId, roleIds, regionIds);
  await seedOAuthClients(db);
  await seedPositions(db);
  await resetSequences(db);
  console.log("\nLocal seed complete.");
  console.log(`  ${DEV_LOGIN_HINT}`);
}

void seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
