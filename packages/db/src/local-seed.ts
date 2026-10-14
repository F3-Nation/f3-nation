/**
 * Local development seed script. Safe to re-run.
 * Run with: pnpm db:seed:local
 * To add data, extend the arrays in ./local-seed-lib/data.ts and re-run.
 */

import { db } from "./client";
import { logError, logInfo } from "./lib/logging";
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
  logInfo("db.seed.start", {});
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
  logInfo("db.seed.done", {});
  process.stdout.write(`\nLocal seed complete.\n  ${DEV_LOGIN_HINT}\n`);
}

void seed()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    logError("db.seed.failed", {}, e);
    process.stderr.write(
      `\nSeed failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  });
