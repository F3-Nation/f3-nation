import fs from "node:fs/promises";
import path from "node:path";
import type { MigrationConfig } from "drizzle-orm/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import type { AppDb } from "../client";
import drizzleConfig from "../../drizzle.config";
import { reset } from "../reset";
import { testSeed } from "../test-seed";
import { createDatabaseIfNotExists, getDb, getDbUrl } from "./functions";

const runPgliteMigrations = async (
  db: PgliteDatabase,
  config: MigrationConfig,
) => {
  const migrationsFolder = path.resolve(process.cwd(), config.migrationsFolder);
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };

  const sortedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of sortedEntries) {
    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const migrationSql = await fs.readFile(migrationPath, "utf8");
    const sanitizedSql = migrationSql
      // PGlite does not ship extensions such as citext
      .replace(/CREATE EXTENSION[^;]+;/gi, "")
      // Treat citext columns as plain text for in-memory runs
      .replace(/"citext"/gi, "text");

    const statements = sanitizedSql
      .split(/-->\s*statement-breakpoint/g)
      .map((statement) => statement.trim())
      .filter(Boolean);

    // Execute each statement directly through the underlying PGlite client so
    // we can send raw SQL strings without prepared statement restrictions.
    const client = (
      db as unknown as { $client?: { exec: (sql: string) => Promise<void> } }
    ).$client;
    if (!client) {
      throw new Error("PGlite client unavailable on database instance");
    }

    for (const statement of statements) {
      await client.exec(statement);
    }
  }
};

export const resetTestDb = async (params?: {
  db?: AppDb;
  shouldReset?: boolean;
  shouldSeed?: boolean;
  seedType?: "test" | "project";
}) => {
  const { databaseUrl, databaseName, driver } = getDbUrl();
  const usePglite = driver === "pglite";

  const shouldReset = params?.shouldReset === true;
  const shouldSeed = params?.shouldSeed === true;

  if (!usePglite) {
    await createDatabaseIfNotExists(databaseUrl)
      .then(() => console.log("Database check/creation completed."))
      .catch((err) => console.error("Failed to check/create database:", err));
  } else {
    console.log("Using in-memory PGlite database for tests.");
  }

  // If we have arg `--reset` then we should reset the database
  if (shouldReset && !usePglite) {
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
  if (usePglite) {
    await runPgliteMigrations((params?.db ?? getDb()) as PgliteDatabase, {
      ...config,
      migrationsFolder: config.migrationsFolder,
    });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(params?.db ?? getDb(), config);
  }

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
