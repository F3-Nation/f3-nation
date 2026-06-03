import { getDb } from "./utils/functions";

export type AppDb = ReturnType<typeof getDb>;

declare global {
  var db: AppDb | null;
}

function resolveDb(): AppDb {
  if (process.env.NODE_ENV === "production") {
    return getDb();
  }
  global.db ??= getDb();
  return global.db;
}

let _db: AppDb | undefined;

// Lazy proxy: the real connection (and DATABASE_URL access) is created on
// first property access, never at import time. This lets `next build` import
// @acme/db without DATABASE_URL being set in the environment.
const db: AppDb = new Proxy({} as AppDb, {
  get(_target, prop) {
    _db ??= resolveDb();
    const value: unknown = (_db as unknown as Record<string | symbol, unknown>)[
      prop
    ];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(_db)
      : value;
  },
});

export { db };
