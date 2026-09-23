/**
 * Carry staging's own API keys across a refresh (F3-65).
 *
 * The obfuscator deletes every api_keys row in the prod copy (prod keys must
 * never reach staging), so loading that copy wipes the service keys staging's
 * own apps authenticate with: the map's F3_MAP_API_KEY, the slackbot's, the
 * auth app's. Every map data call then fails with 401 Unauthorized
 * (real-data finding 2026-09-23).
 *
 * This stashes staging's keys in a holding schema INSIDE staging before the
 * load and restores them afterwards, so key values never leave the database:
 *
 *   --stash    copy api_keys + roles_x_api_keys_x_org into refresh_keep.*
 *   --restore  put them back after the load, owned by --owner-email (the old
 *              owner ids now point at unrelated obfuscated prod users), then
 *              drop refresh_keep
 *
 * Usage (staging, around the load):
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-api-keys -- \
 *     --allow-db <staging-db-name> --stash
 *   ... truncate + load + seed-staging-logins ...
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-api-keys -- \
 *     --allow-db <staging-db-name> --restore --owner-email staging+nation@f3nation.com
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const allowDb = flagValue("--allow-db");
  if (!allowDb) {
    throw new Error(
      "Refusing to run: pass --allow-db <name> naming the exact database.",
    );
  }
  if (databaseNameFromUrl(databaseUrl) !== allowDb) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not point at "${allowDb}".`,
    );
  }
  if (looksLikeProdDbName(allowDb)) {
    throw new Error(
      `Refusing to run: database name "${allowDb}" is (or looks like) production.`,
    );
  }
  const stash = argv.includes("--stash");
  const restore = argv.includes("--restore");
  if (stash === restore) {
    throw new Error("Pass exactly one of --stash or --restore.");
  }
  const ownerEmail = flagValue("--owner-email")?.toLowerCase();
  if (restore && !ownerEmail) {
    throw new Error("--restore needs --owner-email <seeded nation login>.");
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [current] = await sql<{ db: string }[]>`
      SELECT current_database() AS db`;
    if (current?.db !== allowDb) {
      throw new Error(
        `Refusing to run: connected database is "${current?.db}" but --allow-db is "${allowDb}".`,
      );
    }

    if (stash) {
      await sql.begin(async (tx) => {
        const [existing] = await tx<{ present: boolean }[]>`
          SELECT to_regclass('refresh_keep.api_keys') IS NOT NULL AS present`;
        if (existing?.present) {
          throw new Error(
            "refresh_keep.api_keys already exists: a previous stash was never restored. Restore it (or drop refresh_keep) first.",
          );
        }
        await tx`CREATE SCHEMA refresh_keep`;
        await tx`CREATE TABLE refresh_keep.api_keys AS TABLE public.api_keys`;
        await tx`
          CREATE TABLE refresh_keep.roles_x_api_keys_x_org
          AS TABLE public.roles_x_api_keys_x_org`;
      });
      const [n] = await sql<{ keys: number; grants: number }[]>`
        SELECT (SELECT count(*)::int FROM refresh_keep.api_keys) AS keys,
          (SELECT count(*)::int FROM refresh_keep.roles_x_api_keys_x_org) AS grants`;
      console.log(
        `Stashed ${n?.keys} API key(s) and ${n?.grants} grant(s) in refresh_keep.`,
      );
      return;
    }

    await sql.begin(async (tx) => {
      const [owner] = await tx<{ id: number }[]>`
        SELECT id FROM public.users WHERE email = ${ownerEmail!}`;
      if (!owner) {
        throw new Error(
          `No user ${ownerEmail}; run seed-staging-logins before --restore.`,
        );
      }
      // Re-own in the stash first, so a stale owner id can never trip the FK.
      await tx`UPDATE refresh_keep.api_keys SET owner_id = ${owner.id}`;
      const keys = await tx`
        INSERT INTO public.api_keys SELECT * FROM refresh_keep.api_keys
        ON CONFLICT (id) DO NOTHING
        RETURNING id`;
      // The grant table has no unique key, so guard re-runs explicitly; skip
      // grants on an org the loaded copy doesn't have.
      const grants = await tx`
        INSERT INTO public.roles_x_api_keys_x_org (role_id, api_key_id, org_id)
        SELECT g.role_id, g.api_key_id, g.org_id
        FROM refresh_keep.roles_x_api_keys_x_org g
        WHERE EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = g.org_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.roles_x_api_keys_x_org x
            WHERE x.role_id = g.role_id AND x.api_key_id = g.api_key_id
              AND x.org_id = g.org_id)
        RETURNING api_key_id`;
      await tx`
        SELECT setval(pg_get_serial_sequence('public.api_keys', 'id'),
          GREATEST((SELECT max(id) FROM public.api_keys), 1))`;
      await tx`DROP SCHEMA refresh_keep CASCADE`;
      console.log(
        `Restored ${keys.length} API key(s) and ${grants.length} grant(s), owned by ${ownerEmail}.`,
      );
    });
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
