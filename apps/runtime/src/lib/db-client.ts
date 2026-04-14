/**
 * Neon Postgres client for the redirect runtime.
 *
 * Connects as the `redirect_runtime` Postgres role (R5 Decision 8),
 * whose GRANTs are scoped to `SELECT` on exactly five columns of
 * `region_custom_domains`:
 *
 *   id, hostname, region_slug, region_id, lifecycle_state
 *
 * Any attempt to touch another column or table will fail at the DB
 * layer — the runtime is never the authoritative path for anything,
 * so that's a feature.
 *
 * Like `apps/reconciler/src/db/client.ts`, we instantiate Drizzle here
 * directly rather than importing `createRedirectPlatformDb` so we can
 * control pool size and expose `end()` for graceful shutdown. The
 * schema object is the same one shipped by `@acme/redirect-platform-db`.
 */

import { schema } from "@acme/redirect-platform-db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";

export interface CreateRuntimeDbOptions {
  connectionString: string;
  /** Require TLS — always `true` in production (Neon). */
  ssl?: boolean;
  /**
   * Max pool size. The runtime makes exactly one DB call every 60s
   * (the cache refresh), so we only need a single connection.
   */
  max?: number;
}

export interface RuntimeDbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  client: Sql;
  end(): Promise<void>;
}

export function createRuntimeDb(
  options: CreateRuntimeDbOptions,
): RuntimeDbHandle {
  const { connectionString, ssl = true, max = 1 } = options;
  if (!connectionString) {
    throw new Error(
      "createRuntimeDb: connectionString is required (expected a Neon Postgres URL)",
    );
  }
  const client = postgres(connectionString, {
    ssl: ssl ? "require" : false,
    max,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async end() {
      await client.end({ timeout: 5 });
    },
  };
}

export type RuntimeDb = RuntimeDbHandle["db"];
