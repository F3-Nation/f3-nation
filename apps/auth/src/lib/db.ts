import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "@acme/db";

import { env } from "~/env";

const databaseHost = env.DATABASE_HOST;
const databaseUser = env.DATABASE_USER;
const databasePassword = env.DATABASE_PASSWORD;
const databaseName = env.DATABASE_NAME;
const databasePort = env.DATABASE_PORT;

declare global {
  var _db: ReturnType<typeof createDb> | null;
}

function createDb() {
  const client = postgres({
    host: databaseHost,
    port: databasePort,
    user: databaseUser,
    password: databasePassword,
    database: databaseName,
  });

  try {
    return drizzle(client, { schema });
  } catch (err) {
    // Only log safe error details, never the connection string or env
    const safeMessage = err instanceof Error ? err.message : String(err);
    // Optionally, log err.stack if needed for debugging
    const safeStack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        error: "Database connection error",
        message: safeMessage,
        stack: safeStack,
      }),
    );
    throw new Error(
      "Failed to connect to the database. Check configuration and connectivity.",
    );
  }
}

let db: ReturnType<typeof createDb>;

if (env.NODE_ENV === "production") {
  db = createDb();
} else {
  global._db ??= createDb();
  db = global._db;
}

export { db };
