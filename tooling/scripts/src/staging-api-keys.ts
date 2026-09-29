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
 *   --restore  put back only the keys named with --keep (one flag per key
 *              name) and drop refresh_keep. Every other stashed key is
 *              dropped: ad-hoc keys don't outlive a refresh. Without --keep
 *              it lists the stashed keys (no values) and changes nothing.
 *              Each kept key keeps its owner id (ids carry over from prod);
 *              pass --owner-email to re-own them all instead
 *
 * Usage (staging, around the load):
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-api-keys -- \
 *     --allow-db <staging-db-name> --stash
 *   ... truncate + load ...
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-api-keys -- \
 *     --allow-db <staging-db-name> --restore \
 *     --keep "<map key name>" --keep "<slackbot key name>" ... \
 *     [--owner-email <user email>]
 */
import type postgres from "postgres";

import {
  connectToStaging,
  flagValue,
  flagValues,
  stashOrRestore,
} from "./staging-target";

const argv = process.argv.slice(2);

interface StashedKey {
  id: number;
  name: string;
  owner_id: number | null;
  key_length: number;
  revoked: boolean;
  grants: number;
}

async function listStashed(
  tx: postgres.Sql | postgres.TransactionSql,
): Promise<StashedKey[]> {
  return tx<StashedKey[]>`
    SELECT k.id, k.name, k.owner_id, length(k.key)::int AS key_length,
      k.revoked_at IS NOT NULL AS revoked,
      (SELECT count(*)::int FROM refresh_keep.roles_x_api_keys_x_org g
        WHERE g.api_key_id = k.id) AS grants
    FROM refresh_keep.api_keys k ORDER BY k.id`;
}

function describe(k: StashedKey): string {
  return `  #${k.id} "${k.name}" (owner ${k.owner_id ?? "none"}, ${k.key_length}-char key, ${k.grants} grant(s)${k.revoked ? ", revoked" : ""})`;
}

async function main(): Promise<void> {
  const mode = stashOrRestore(argv);
  const ownerEmail = flagValue(argv, "--owner-email")?.toLowerCase();
  const keep = new Set(flagValues(argv, "--keep"));

  const sql = await connectToStaging(argv);
  try {
    if (mode === "stash") {
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

    if (keep.size === 0) {
      const stashed = await listStashed(sql);
      throw new Error(
        `Refusing to restore without --keep: name each key staging's apps ` +
          `use (one --keep per name). Every other key is dropped. Stashed:\n` +
          stashed.map(describe).join("\n"),
      );
    }

    await sql.begin(async (tx) => {
      const stashed = await listStashed(tx);
      const unknown = [...keep].filter(
        (name) => !stashed.some((k) => k.name === name),
      );
      if (unknown.length > 0) {
        throw new Error(
          `No stashed key named ${unknown.map((n) => `"${n}"`).join(", ")}. Stashed:\n` +
            stashed.map(describe).join("\n"),
        );
      }
      const dropped = stashed.filter((k) => !keep.has(k.name));
      const droppedIds = dropped.map((k) => k.id);
      if (droppedIds.length > 0) {
        await tx`
          DELETE FROM refresh_keep.roles_x_api_keys_x_org
          WHERE api_key_id IN ${tx(droppedIds)}`;
        await tx`DELETE FROM refresh_keep.api_keys WHERE id IN ${tx(droppedIds)}`;
      }

      if (ownerEmail) {
        const [owner] = await tx<{ id: number }[]>`
          SELECT id FROM public.users WHERE email = ${ownerEmail}`;
        if (!owner) throw new Error(`No user ${ownerEmail} in the target.`);
        await tx`UPDATE refresh_keep.api_keys SET owner_id = ${owner.id}`;
      }
      const orphans = await tx<{ id: number }[]>`
        SELECT k.id FROM refresh_keep.api_keys k
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = k.owner_id)`;
      if (orphans.length > 0) {
        throw new Error(
          `${orphans.length} stashed key(s) have an owner id the loaded copy doesn't have; re-run with --owner-email <user email>.`,
        );
      }
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
        `Restored ${keys.length} API key(s) and ${grants.length} grant(s)${ownerEmail ? `, owned by ${ownerEmail}` : ""}.`,
      );
      if (dropped.length > 0) {
        console.log(
          `Dropped ${dropped.length} key(s) not named with --keep:\n` +
            dropped.map(describe).join("\n"),
        );
      }
    });
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
