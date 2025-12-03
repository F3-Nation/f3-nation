import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import pgConnectionString from "pg-connection-string";
import postgres from "postgres";

import { env } from "@acme/env";
import { isTest } from "@acme/shared/common/constants";

import { schema } from "..";

const usePglite = isTest && process.env.TEST_USE_PGLITE === "true";

type DbConfig = {
  driver: "postgres" | "pglite";
  databaseUrl: string;
  databaseName?: string;
  useSsl: boolean;
};

export const getDatabaseNameFromUri = (uri: string) => {
  const databaseNameRegex = /\/([^/?]+)(\?|$)/;
  const databaseNameMatch = databaseNameRegex.exec(uri);
  return databaseNameMatch ? databaseNameMatch[1] : undefined;
};

export const getDbUrl = (): DbConfig => {
  if (usePglite) {
    return {
      driver: "pglite",
      databaseUrl: "pglite://in-memory",
      databaseName: "pglite_test",
      useSsl: false,
    };
  }

  const databaseUrl = isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  const databaseName = getDatabaseNameFromUri(databaseUrl);
  // Remove SSL to enable PGBouncer to work
  const useSsl = false; //  isProduction || (databaseName?.includes("_prod") ?? false);
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined");
  return { driver: "postgres", databaseUrl, useSsl, databaseName };
};

type PgliteDb = ReturnType<typeof drizzlePglite>;

let pglite: PGlite | null = null;
let pgliteDb: PgliteDb | null = null;

export const getDb = () => {
  const { databaseUrl, useSsl, driver } = getDbUrl();
  if (driver === "pglite") {
    if (!pgliteDb) {
      pglite = new PGlite();
      pgliteDb = drizzlePglite(pglite, { schema });
    }
    return pgliteDb;
  }
  const sslOptions = useSsl ? { ssl: "require" as const } : undefined;
  return drizzlePostgres(postgres(databaseUrl, sslOptions), { schema });
};

export async function createDatabaseIfNotExists(
  connectionString: string,
): Promise<void> {
  if (usePglite) return;

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
