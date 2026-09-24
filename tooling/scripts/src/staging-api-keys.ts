/**
 * Provision staging's own API keys after a refresh (F3-65).
 *
 * The obfuscator deletes every api_keys row in the prod copy (prod keys must
 * never reach staging), which leaves staging's own services (map, auth,
 * slackbot) with nothing to authenticate against: every map data call then
 * fails with 401 Unauthorized (real-data finding 2026-09-23).
 *
 * This writes the declared service keys (staging-service-keys.ts) back:
 *
 *   - values come from the env vars the list names, never from the database,
 *     so a refresh no longer depends on staging's old rows
 *   - each key is upserted by value and named per the list; an older row with
 *     the same name but another value (a rotated key) is revoked
 *   - grants are rebuilt from the list against the nation org, resolved by
 *     org type, never by an id carried over from before the load
 *   - every key is owned by --owner-id, an existing users.id
 *   - --revoke-unlisted revokes every other live key (hand-made test keys,
 *     anything created on staging since the last refresh)
 *   - --dry-run does all of it in a transaction and rolls back
 *
 * Usage (staging, after the load or an in-place obfuscation):
 *   STAGING_MAP_API_KEY=… STAGING_AUTH_API_KEY=… STAGING_SLACKBOT_API_KEY=… \
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-api-keys -- \
 *     --allow-db <staging-db-name> --provision --owner-id <users.id> \
 *     [--revoke-unlisted] [--dry-run]
 *
 * Key values are never printed, only their first and last four characters.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";
import {
  MIN_SERVICE_KEY_LENGTH,
  STAGING_SERVICE_KEYS,
} from "./staging-service-keys";

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

const signature = (key: string) => `${key.slice(0, 4)}...${key.slice(-4)}`;

class DryRunRollback extends Error {}

/** Read and validate every declared key's value before touching the DB. */
function readKeyValues(): Map<string, string> {
  const values = new Map<string, string>();
  const problems: string[] = [];
  for (const entry of STAGING_SERVICE_KEYS) {
    const value = process.env[entry.valueEnv]?.trim();
    if (!value) problems.push(`${entry.valueEnv} is not set`);
    else if (value.length < MIN_SERVICE_KEY_LENGTH) {
      problems.push(
        `${entry.valueEnv} is shorter than ${MIN_SERVICE_KEY_LENGTH} characters`,
      );
    } else values.set(entry.name, value);
  }
  if (new Set(values.values()).size !== values.size) {
    problems.push("two service keys share a value; each needs its own");
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to provision:\n  - ${problems.join("\n  - ")}`);
  }
  return values;
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
  if (argv.includes("--stash") || argv.includes("--restore")) {
    throw new Error(
      "--stash/--restore were removed: staging's keys are now declared in staging-service-keys.ts and written with --provision (see docs/STAGING_REFRESH.md).",
    );
  }
  if (!argv.includes("--provision")) {
    throw new Error("Pass --provision.");
  }
  const ownerId = Number(flagValue("--owner-id"));
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error("Pass --owner-id <users.id> for the keys' owner.");
  }
  const revokeUnlisted = argv.includes("--revoke-unlisted");
  const dryRun = argv.includes("--dry-run");
  const values = readKeyValues();

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [current] = await sql<{ db: string }[]>`
      SELECT current_database() AS db`;
    if (current?.db !== allowDb) {
      throw new Error(
        `Refusing to run: connected database is "${current?.db}" but --allow-db is "${allowDb}".`,
      );
    }

    await sql.begin(async (tx) => {
      const [owner] = await tx<{ id: number }[]>`
        SELECT id FROM users WHERE id = ${ownerId}`;
      if (!owner) throw new Error(`No user with id ${ownerId} in the target.`);

      const nations = await tx<{ id: number }[]>`
        SELECT id FROM orgs WHERE org_type = 'nation' AND is_active`;
      if (nations.length !== 1) {
        throw new Error(
          `Expected exactly one active nation org, found ${nations.length}.`,
        );
      }
      const nationId = nations[0]!.id;
      const roleRows = await tx<{ id: number; name: string }[]>`
        SELECT id, name::text AS name FROM roles`;
      const roleIds = new Map(roleRows.map((r) => [r.name, r.id]));

      // A data-only load can leave the sequence behind max(id).
      await tx`
        SELECT setval(pg_get_serial_sequence('public.api_keys', 'id'),
          GREATEST((SELECT max(id) FROM api_keys), 1))`;

      for (const entry of STAGING_SERVICE_KEYS) {
        const value = values.get(entry.name)!;
        const [key] = await tx<{ id: number }[]>`
          INSERT INTO api_keys (key, name, description, owner_id)
          VALUES (${value}, ${entry.name}, ${entry.description}, ${ownerId})
          ON CONFLICT (key) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            owner_id = EXCLUDED.owner_id,
            revoked_at = NULL,
            expires_at = NULL,
            updated = timezone('utc'::text, now())
          RETURNING id`;
        const keyId = key!.id;

        const rotated = await tx`
          UPDATE api_keys SET revoked_at = timezone('utc'::text, now()),
            updated = timezone('utc'::text, now())
          WHERE name = ${entry.name} AND id <> ${keyId} AND revoked_at IS NULL
          RETURNING id`;

        await tx`DELETE FROM roles_x_api_keys_x_org WHERE api_key_id = ${keyId}`;
        if (entry.role !== null) {
          const roleId = roleIds.get(entry.role);
          if (roleId === undefined) {
            throw new Error(`No "${entry.role}" role in the target.`);
          }
          await tx`
            INSERT INTO roles_x_api_keys_x_org (role_id, api_key_id, org_id)
            VALUES (${roleId}, ${keyId}, ${nationId})`;
        }
        console.log(
          `  ${entry.name} (${signature(value)}) -> ${entry.role ?? "read-only"}` +
            `${entry.role ? " on nation" : ""}, for ${entry.consumer}` +
            `${rotated.length > 0 ? `; revoked ${rotated.length} older key(s)` : ""}`,
        );
      }

      if (revokeUnlisted) {
        const declared = STAGING_SERVICE_KEYS.map((k) => k.name);
        const revoked = await tx<{ id: number; name: string }[]>`
          UPDATE api_keys SET revoked_at = timezone('utc'::text, now()),
            updated = timezone('utc'::text, now())
          WHERE revoked_at IS NULL AND NOT (name = ANY(${declared}))
          RETURNING id, name`;
        console.log(
          revoked.length === 0
            ? "  No undeclared live keys."
            : `  Revoked ${revoked.length} undeclared key(s): ${revoked
                .map((r) => `#${r.id} "${r.name}"`)
                .join(", ")}`,
        );
      }

      if (dryRun) throw new DryRunRollback();
    });
    console.log(
      `Provisioned ${STAGING_SERVICE_KEYS.length} staging service key(s), owned by user ${ownerId}.`,
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    console.log("Dry run: rolled back, nothing written.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
