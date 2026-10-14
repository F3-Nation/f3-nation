/**
 * `pnpm db:migrate:local`: apply
 * pending migrations to the LOCAL database in packages/db/.env. Refuses
 * anything that isn't local, including a Cloud SQL database reached through
 * a proxy on localhost: staging and prod are migrated only with
 * `pnpm db:migrate:staging` / `pnpm db:migrate:prod` (migrate-remote.ts).
 */
import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";

import { env } from "@acme/env";

import { sql } from ".";
import { db } from "./client";
import { assertLocalTarget } from "./migrate-guards";
import { alembicVersionValue, reset } from "./reset";
import {
  createDatabaseIfNotExists,
  getDbUrl,
  migrationsDatabaseName,
} from "./utils/functions";

const databaseUrl = env.DATABASE_URL;

export const migrate = async () => {
  if (!databaseUrl) return;
  // CI must opt in explicitly (preview-env.yml runs it with CI= against its
  // own throwaway Postgres). This used to return silently and still print
  // "Migration done"; now it says so and fails.
  if (process.env.CI) {
    throw new Error(
      "Not migrating: CI is set. To migrate a local database from a CI job, run it with CI= (empty).",
    );
  }

  // The migrator's client connects to getDbUrl()'s URL, which is
  // TEST_DATABASE_URL under NODE_ENV=test: check that one too.
  await assertLocalTarget(databaseUrl);
  const clientUrl = getDbUrl().databaseUrl;
  if (clientUrl !== databaseUrl) await assertLocalTarget(clientUrl);

  try {
    await createDatabaseIfNotExists(databaseUrl);
    console.log("Database check/creation completed.");
  } catch (err) {
    console.error("Failed to check/create database:", err);
    throw err;
  }

  // If we have arg `--reset` then we should reset the database
  if (process.argv.includes("--reset")) {
    await reset();
  }

  // Named like the TCP form of this URL, so migration history survives a
  // transport switch. Changing any other URL parameter renames the table.
  const database = migrationsDatabaseName(databaseUrl);
  if (!database)
    throw new Error("Could not read the database name from DATABASE_URL");

  console.log("Migrating database", database);
  await migrator(db, {
    migrationsTable: `__drizzle_migrations_${database}`,
    migrationsFolder: "drizzle",
  });

  // We need to manually handle the alembic version table for moneyball's work
  if (alembicVersionValue) {
    await db.execute(sql`
      INSERT INTO alembic_version (version_num) VALUES (${alembicVersionValue});
    `);
  }
};

if (require.main === module) {
  void migrate()
    .then(() => console.log("Migration done"))
    .catch((e) => {
      console.error("Migration failed", e);
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit();
    });
}
