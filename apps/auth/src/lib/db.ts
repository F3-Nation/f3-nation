import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "@acme/db";

import { env } from "~/env";

const databaseUrl = env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var _db: ReturnType<typeof createDb> | null;
}

function createDb() {
  return drizzle(postgres(databaseUrl), { schema });
}

let db: ReturnType<typeof createDb>;

if (env.NODE_ENV === "production") {
  db = createDb();
} else {
  if (!global._db) global._db = createDb();
  db = global._db;
}

export { db };
