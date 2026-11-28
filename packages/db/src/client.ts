import { createDbClient, getDb } from "./utils/functions";

export type AppDb = ReturnType<typeof getDb>;

declare global {
  var db: AppDb | null;
}

function resolveDb(): AppDb {
  if (shuttingDown) throw new Error("Database client is shutting down");
  if (recoveryEnabled) {
    recoveringClient ??= createDbClient({ recover: true });
    return recoveringClient.db;
  }
  if (process.env.NODE_ENV === "production") {
    return getDb();
  }
  global.db ??= getDb();
  return global.db;
}

let _db: AppDb | undefined;
let recoveryEnabled = false;
let shuttingDown = false;
let recoveringClient: ReturnType<typeof createDbClient> | undefined;

/** Opt in before first use; other apps retain their existing pool lifecycle. */
export function enableDbRecovery() {
  if (_db)
    throw new Error("Enable database recovery before first database use");
  recoveryEnabled = true;
}

/** A physical probe; health callers bound their own response deadline. */
export const checkDb = () => {
  if (shuttingDown) throw new Error("Database client is shutting down");
  if (!recoveryEnabled) throw new Error("Database recovery is not enabled");
  _db ??= resolveDb();
  return recoveringClient!.check();
};

export const isDbLive = () => recoveringClient?.isLive() ?? true;
export const closeDb = async () => {
  shuttingDown = true;
  await recoveringClient?.close();
};

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
