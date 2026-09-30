import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";

import { env } from "@acme/env";

import { sql } from ".";
import { db } from "./client";
import { alembicVersionValue, reset } from "./reset";
import { seed } from "./seed";
import {
  createDatabaseIfNotExists,
  getDatabaseNameFromUri,
} from "./utils/functions";

const databaseUrl = env.DATABASE_URL;

const migrate = async () => {
  if (!databaseUrl) return;
  if (process.env.CI) return;

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

  // Not `databaseUrl.split("/").pop()`: with a query string (e.g. a Cloud
  // SQL socket `?host=/cloudsql/…`) that yields "f3_prod?host=…", which
  // names a brand-new migrations table and re-runs every migration.
  const database = getDatabaseNameFromUri(databaseUrl);
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

  if (process.argv.includes("--seed")) {
    console.log("Seeding database");
    await seed();
  }
};

if (require.main === module) {
  void migrate()
    .then(() => console.log("Migration done"))
    .catch((e) => {
      console.log("Migration failed", e);
    })
    .finally(() => {
      process.exit();
    });
}
