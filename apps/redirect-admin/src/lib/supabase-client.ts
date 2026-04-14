/**
 * Read-side client for the f3-nation Supabase DB. We intentionally do
 * NOT import `@acme/db/client` because that module eagerly loads
 * `@acme/env`, which pulls in the full monorepo env schema — way more
 * than this app needs. Instead we instantiate our own Drizzle handle
 * against the same schema using `DATABASE_URL` directly.
 *
 * Scope: read-only queries on `orgs`, `rolesXUsersXOrg`, and `roles`
 * for populating the landing page's "orgs you admin" list. The admin
 * UI never WRITES to Supabase; that's owned by the F3 Nation API.
 */

import "server-only";

import { schema as supabaseSchema } from "@acme/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";

import { env } from "@/env";

export type SupabaseDb = ReturnType<typeof drizzle<typeof supabaseSchema>>;

export interface SupabaseDbHandle {
  db: SupabaseDb;
  client: Sql;
  end(): Promise<void>;
}

let _cached: SupabaseDbHandle | null = null;

export function getSupabaseDb(): SupabaseDbHandle {
  if (_cached) return _cached;
  const connectionString = env().supabaseConnectionString;
  const client = postgres(connectionString, {
    // PgBouncer compatibility in dev; prod is handled by the f3-nation
    // deploy stack.
    ssl: false,
    max: 4,
  });
  const db = drizzle(client, { schema: supabaseSchema });
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

export { supabaseSchema };
