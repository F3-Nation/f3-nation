/**
 * Local development seed script. Safe to re-run.
 * Run with: pnpm db:seed:local
 * To add data, extend the arrays in ./local-seed-lib/data.ts and re-run.
 */

import { db } from "./client";
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
  const allEventTypes = await seedEventTypes(db);
  await seedAoLocationsAndEvents(db, aoIds, regionIds, allEventTypes);
  const { adminUserId, roleIds } = await seedDevUsers(db, nationId);
  await seedApiKeys(db, adminUserId, nationId, roleIds);
  await seedOAuthClients(db);
  await seedPositions(db);
  await resetSequences(db);
  console.log("\nLocal seed complete.");
  console.log(
    "  Log in with: dev-admin@f3local.dev, dev-editor@f3local.dev, or dev-user@f3local.dev",
  );
}

void seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
