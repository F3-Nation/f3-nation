import { drizzle } from "drizzle-orm/postgres-js";
import pgConnectionString from "pg-connection-string";
import postgres from "postgres";

import { env } from "@acme/env";
import { isTest } from "@acme/shared/common/constants";

import { schema } from "..";

const getDatabaseNameFromUri = (uri: string) => {
  const databaseNameRegex = /\/([^/?]+)(\?|$)/;
  const databaseNameMatch = databaseNameRegex.exec(uri);
  return databaseNameMatch ? databaseNameMatch[1] : undefined;
};

export const getDbUrl = () => {
  const databaseUrl = isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined");
  const databaseName = getDatabaseNameFromUri(databaseUrl);
  // Remove SSL to enable PGBouncer to work
  const useSsl = false; //  isProduction || (databaseName?.includes("_prod") ?? false);
  return { databaseUrl, useSsl, databaseName };
};

export const createDbClient = () => {
  const { databaseUrl, useSsl } = getDbUrl();
  const sslOptions = useSsl ? { ssl: "require" as const } : undefined;
  const client = postgres(databaseUrl, {
    ...sslOptions,
    // Cloud Run scales to many instances, each holding its own pool (see
    // client.ts) — an untuned client defaults to `max: 10` per instance,
    // which exhausts the pooler's client ceiling under autoscaling.
    // connect_timeout tightens postgres-js's 30s default to 10s so a
    // saturated pooler surfaces as a fast failure instead of a slow one.
    // Sizing rationale: docs/AI_DEVELOPMENT_GUIDE.md ("Data layer").
    // max_lifetime is deliberately left on its postgres-js default — a
    // jittered 30–60min per connection; a fixed value would synchronize
    // expiry across every connection of a deploy into periodic reconnect
    // stampedes through the pooler.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // PgBouncer fronts the database in transaction pooling mode, which does
    // not support named prepared statements. Drizzle survives on the default
    // only because it issues queries through `client.unsafe()` (unprepared);
    // direct tagged-template usage (e.g. the seed/reset scripts) prepares by
    // default and would fail intermittently through the pooler.
    prepare: false,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
};

export const getDb = () => createDbClient().db;

export async function createDatabaseIfNotExists(
  connectionString: string,
): Promise<void> {
  const config = pgConnectionString.parse(connectionString);
  const dbName = config.database;
  if (!dbName) {
    throw new Error("Database name not found in connection string");
  }

  // Remove the database name from the connection string
  const newConnectionString = connectionString.replace(
    `/${dbName}`,
    "/postgres",
  );
  const useSsl = false; // dbName?.includes("_prod") ?? false;

  // Connect to the default 'postgres' database
  const sql = postgres(newConnectionString, {
    ssl: useSsl,
  });

  try {
    // Check if the database exists
    const result = await sql`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;

    if (result.length === 0) {
      console.log(`Database ${dbName} does not exist. Creating it now...`);
      // Create the database
      await sql`CREATE DATABASE ${sql(dbName)}`;
      console.log(`Database ${dbName} created successfully.`);
    } else {
      console.log(`Database ${dbName} already exists.`);
    }
  } catch (error) {
    console.error("Error creating database:", error);
    throw error;
  } finally {
    await sql.end();
  }
}
