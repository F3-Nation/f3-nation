import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "@acme/db";

import { logError } from "~/lib/logging";
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
    // Pino's err serializer extracts message/stack/cause; it never logs the
    // connection string or env.
    logError("auth.db.connection_error", {}, err);
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
