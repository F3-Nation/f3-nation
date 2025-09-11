import { env } from "@acme/env";

import { getDb } from "./utils/functions";

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not defined");

export type AppDb = ReturnType<typeof getDb>;

declare global {
  // eslint-disable-next-line no-var
  var db: AppDb | null;
}

let db: AppDb;

if (env.NODE_ENV === "production") {
  db = getDb();
} else {
  if (!global.db) global.db = getDb();
  db = global.db;
}

export { db };
