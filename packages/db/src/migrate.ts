/**
 * `pnpm db:migrate:local` (and `pnpm db:migrate`, the same command): apply
 * pending migrations to the LOCAL database in packages/db/.env. Refuses
 * anything that isn't local, including a Cloud SQL database reached through
 * a proxy on localhost: staging and prod are migrated only with
 * `pnpm db:migrate:staging` / `pnpm db:migrate:prod` (migrate-remote.ts).
 */
import { migrate as migrator } from "drizzle-orm/postgres-js/migrator";
import pgConnectionString from "pg-connection-string";
import postgres from "postgres";

import { env } from "@acme/env";

import { sql } from ".";
import { db } from "./client";
import { classifyHost, isProtectedDatabaseName } from "./migrate-guards";
import { alembicVersionValue, reset } from "./reset";
import {
  createDatabaseIfNotExists,
  migrationsDatabaseName,
  postgresArgs,
} from "./utils/functions";

const databaseUrl = env.DATABASE_URL;

const REMOTE_HELP =
  "pnpm db:migrate only migrates a local database. Staging and prod are " +
  "migrated from main, after merge, with `pnpm db:migrate:staging` or " +
  "`pnpm db:migrate:prod` (docs/db-migrations.md).";

/**
 * Refuse a non-local target before anything connects to it for writing:
 * by URL (host, database name), then by asking the server, which also
 * catches a Cloud SQL instance behind a cloud-sql-proxy on localhost.
 */
const assertLocalTarget = async (url: string) => {
  if (classifyHost(url) !== "local") {
    throw new Error(
      `Refusing to migrate: DATABASE_URL in packages/db/.env is not a local database. ${REMOTE_HELP}`,
    );
  }
  const name = pgConnectionString.parse(url).database ?? "";
  if (isProtectedDatabaseName(name)) {
    throw new Error(
      `Refusing to migrate database "${name}": it is named like staging or prod. ${REMOTE_HELP}`,
    );
  }
  // The server-wide catalog answers this from the maintenance database, so
  // it works before the target database exists.
  const { url: maintenanceUrl, hostOptions } = postgresArgs(
    url.replace(`/${name}`, "/postgres"),
  );
  const client = postgres(maintenanceUrl, {
    ...hostOptions,
    max: 1,
    onnotice: () => undefined,
    connection: { default_transaction_read_only: true },
  });
  try {
    const [row] = await client<{ cloudsql: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser')
        AS cloudsql`;
    if (row?.cloudsql) {
      throw new Error(
        `Refusing to migrate: DATABASE_URL reaches a Cloud SQL server (probably through a proxy on localhost). ${REMOTE_HELP}`,
      );
    }
  } finally {
    await client.end();
  }
};

const migrate = async () => {
  if (!databaseUrl) return;
  if (process.env.CI) return;

  await assertLocalTarget(databaseUrl);

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
