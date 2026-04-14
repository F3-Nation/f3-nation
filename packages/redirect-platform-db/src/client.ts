import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "./schema";

/**
 * Options accepted by {@link createRedirectPlatformDb}. Keep the surface area
 * minimal — if a caller needs to tune `postgres-js` further we can thread
 * additional fields through here explicitly (no spread of arbitrary options).
 */
export interface CreateRedirectPlatformDbOptions {
  /**
   * Full Postgres connection string for the Neon `f3-redirect-platform`
   * project. Each runtime role (runtime / reconciler / admin UI / platform
   * admin) has its own connection string stored in Secret Manager; the
   * caller picks the right one.
   */
  connectionString: string;
  /**
   * Require TLS on the connection. Neon requires TLS in production, but
   * we let the caller opt out for local PgBouncer proxies and tests.
   * Defaults to `true`.
   */
  ssl?: boolean;
  /**
   * Max pool size for the underlying `postgres-js` client. Defaults to the
   * library default; expose it so the reconciler (singleton, low-concurrency)
   * and the runtime (hot path, many concurrent reads) can tune separately.
   */
  max?: number;
}

export type RedirectPlatformDb = ReturnType<typeof createRedirectPlatformDb>;

/**
 * Build a Drizzle client wired to the redirect-platform Neon database.
 *
 * Mirrors the shape of {@link file://./../../db/src/utils/functions.ts `getDb`}
 * in `@acme/db` — returns a `drizzle()` handle with `schema` attached so
 * callers get typed relational queries on every table in this package.
 */
export function createRedirectPlatformDb(
  options: CreateRedirectPlatformDbOptions,
) {
  const { connectionString, ssl = true, max } = options;
  if (!connectionString) {
    throw new Error(
      "createRedirectPlatformDb: connectionString is required (expected a Neon Postgres URL)",
    );
  }

  const client = postgres(connectionString, {
    ssl: ssl ? "require" : false,
    ...(max !== undefined ? { max } : {}),
  });

  return drizzle(client, { schema });
}
