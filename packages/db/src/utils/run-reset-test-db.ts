import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";

import type { AppDb } from "../client";
import { reset } from "../reset";
import { testSeed } from "../test-seed";
import { createDatabaseIfNotExists, getDb, getDbUrl } from "./functions";

const shouldSkipReset = () => {
  if (
    process.env.SKIP_RESET_TEST_DB === "1" ||
    process.env.SKIP_RESET_TEST_DB === "true"
  ) {
    console.log(
      "SKIP_RESET_TEST_DB flag detected. Skipping test database reset.",
    );
    return true;
  }

  if (process.env.NODE_ENV === "test" && !process.env.TEST_DATABASE_URL) {
    if (process.env.CI) {
      throw new Error("TEST_DATABASE_URL is required in CI to reset the DB.");
    }

    console.warn(
      "TEST_DATABASE_URL is not set. Skipping reset-test-db locally; set it to run migrations during tests.",
    );
    return true;
  }

  return false;
};

export const resetTestDb = async (params?: {
  db?: AppDb;
  shouldReset?: boolean;
  shouldSeed?: boolean;
  seedType?: "test" | "project";
}) => {
  if (shouldSkipReset()) {
    return;
  }

  const { databaseUrl, databaseName } = getDbUrl();
  const config = {
    migrationsTable: `__drizzle_migrations_${databaseName}`,
    migrationsFolder: "../db/drizzle",
  };

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
