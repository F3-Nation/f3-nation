/**
 * Drizzle client factory for the redirect-admin UI, wired to the
 * `redirect_admin_ui` Neon role (R5 Decision 8). Pool size is small
 * (8) because every request does at most a handful of statements and
 * Cloud Run scales horizontally.
 *
 * Matches the shape of `apps/reconciler/src/db/client.ts` — we
 * instantiate Drizzle locally rather than calling
 * `createRedirectPlatformDb()` so we can share the `postgres.Sql` handle
 * if we ever need raw-SQL template strings for the trigger-gated
 * INSERT path.
 */

import "server-only";

import { schema } from "@acme/redirect-platform-db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";

import { env } from "@/env";

export type RedirectAdminDb = ReturnType<typeof drizzle<typeof schema>>;

export interface RedirectAdminDbHandle {
  db: RedirectAdminDb;
  client: Sql;
  end(): Promise<void>;
}

let _cached: RedirectAdminDbHandle | null = null;

export function getRedirectAdminDb(): RedirectAdminDbHandle {
  if (_cached) return _cached;
  const connectionString = env().neonAdminUiConnectionString;
  const client = postgres(connectionString, {
    ssl: "require",
    max: 8,
  });
  const db = drizzle(client, { schema });
  _cached = {
    db,
    client,
    async end() {
      await client.end({ timeout: 5 });
      _cached = null;
    },
  };
  return _cached;
}
