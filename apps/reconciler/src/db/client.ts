/**
 * Neon Postgres client for the reconciler.
 *
 * Imports the canonical Drizzle schema from `@acme/redirect-platform-db`
 * (R5 Decision 7). Pool size is 2 because the reconciler is a singleton
 * via the `reconciler_leases` lease — concurrency is deliberately tiny.
 *
 * SSL is required for Neon in production; callers can disable it for
 * local PgBouncer proxies or tests.
 *
 * NOTE: we intentionally instantiate a Drizzle client here rather than
 * calling `createRedirectPlatformDb` from `@acme/redirect-platform-db`
 * because the reconciler needs to share the same `postgres.Sql` handle
 * with the lease module (which uses raw tagged templates against
 * `reconciler_leases`). The schema object is identical either way.
 */

import { schema } from "@acme/redirect-platform-db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";

export interface CreateReconcilerDbOptions {
  connectionString: string;
  ssl?: boolean;
  max?: number;
}

export interface ReconcilerDbHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  client: Sql;
  end(): Promise<void>;
}

export function createReconcilerDb(
  options: CreateReconcilerDbOptions,
): ReconcilerDbHandle {
  const { connectionString, ssl = true, max = 2 } = options;
  if (!connectionString) {
    throw new Error(
      "createReconcilerDb: connectionString is required (expected a Neon Postgres URL)",
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

export type ReconcilerDb = ReconcilerDbHandle["db"];
