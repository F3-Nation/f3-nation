import type { PgDialect, PgSession } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js/driver";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { env } from "@acme/env";

import drizzleConfig from "../drizzle.config";
import { db as connection } from "./client";

const config = {
  ...drizzleConfig,
  migrationsFolder: drizzleConfig.out,
  migrationsTable: drizzleConfig.migrations.table,
  migrationsSchema: drizzleConfig.migrations.schema,
};

const migrations = readMigrationFiles(config);

const table_name = `${config.migrationsSchema}.${config.migrationsTable}`;

type Schema = typeof connection._.fullSchema;

const databaseUrl = env.DATABASE_URL;

async function main() {
  if (!databaseUrl) return;
  if (process.env.CI) return;

  process.stdout.write(
    `Resetting migrations for database ${databaseUrl} ARE YOU SURE? (y/n): `,
  );
  const db =
    connection as PostgresJsDatabase<Schema> as unknown as PostgresJsDatabase<Schema> & {
      dialect: PgDialect;
      session: PgSession;
    };

  const confirmation = await new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
  if (confirmation !== "y") {
    throw new Error("Reset cancelled");
  }

  console.log("~..................¯\\_(ツ)_/¯..................~");
  console.log("Drizzle Migration Hardsync");
  console.log("~...............................................~");
  console.log(
    "If you `drizzle-kit push` you ruin the migration history.\r\nThis script will drop the migration table and create a new one.",
  );
  console.log("~...............................................~");
  console.log("~...............................................~");

  console.log("... Dropping Existing Migration Table");
  // Drop the migration table if it exists
  await connection.execute(`DROP TABLE IF EXISTS ${table_name}`);
  console.log("... Existing Migration Table Dropped");

  console.log("... Creating Migration Table");
  // Since we pass no migrations, it only creates the table.
  await db.dialect.migrate([], db.session, {
    migrationsFolder: config.migrationsFolder,
    migrationsTable: config.migrationsTable,
  });
  console.log("... Migration Table Created");
  console.log(`... Inserting ${migrations.length} Migrations`);

  const promises: Promise<void>[] = [];
  for (const migration of migrations) {
    console.log(`... Applying migration ${migration.hash}`);

    // Add migration hashes to migration table
    promises.push(
      connection
        .execute(
          `INSERT INTO ${table_name} (hash, created_at) VALUES ('${migration.hash}', ${migration.folderMillis})`,
        )
        .then(() => console.log(`... Applied migration ${migration.hash}`)),
    );
  }

  await Promise.all(promises);

  console.log("~...............................................~");
  console.log("~.. Migration Hardsync Complete! ˶ᵔ ᵕ ᵔ˶........~");
  console.log("~...............................................~");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
