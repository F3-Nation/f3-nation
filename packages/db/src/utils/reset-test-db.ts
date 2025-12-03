import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";

import type { AppDb } from "../client";
import drizzleConfig from "../../drizzle.config";
import { reset } from "../reset";
import { testSeed } from "../test-seed";
import { createDatabaseIfNotExists, getDb, getDbUrl } from "./functions";

export const resetTestDb = async (params?: {
  db?: AppDb;
  shouldReset?: boolean;
  shouldSeed?: boolean;
  seedType?: "test" | "project";
}) => {
  const { databaseUrl, databaseName } = getDbUrl();

  const shouldReset = params?.shouldReset === true;
  const shouldSeed = params?.shouldSeed === true;

  await createDatabaseIfNotExists(databaseUrl)
    .then(() => console.log("Database check/creation completed."))
    .catch((err) => console.error("Failed to check/create database:", err));

  // If we have arg `--reset` then we should reset the database
  if (shouldReset) {
    console.log("Resetting database");
    await reset();
  }

  const config = {
    migrationsTable: drizzleConfig.migrations.table,
    migrationsFolder: drizzleConfig.out,
  };
  console.log("Migrating database", databaseName, {
    shouldReset,
    shouldSeed,
    config,
  });
  await migrator(params?.db ?? getDb(), config);

  if (shouldSeed) {
    console.log("Seeding database...");
    if (params?.seedType === "test") {
      await testSeed(params?.db ?? getDb());
    } else {
      // Import and run project seed
      const { seed } = await import("../seed");
      await seed();
    }
  }
};

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  // May need to seed the database for testing
  void resetTestDb({
    shouldReset: true,
    shouldSeed: true,
    seedType: "test",
  })
    .then(() => console.log("Migration done"))
    .catch((e) => {
      console.log("Migration failed", e);
    })
    .finally(() => {
      process.exit();
    });
}
