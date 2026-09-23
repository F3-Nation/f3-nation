/**
 * Seed sign-in identities into staging after an obfuscated refresh (F3-65).
 *
 * A refresh leaves staging with no way in: sessions are truncated and every
 * users.email is an unroutable @obfuscated.f3nation.dev address, so the auth
 * app's email-OTP can't deliver a code to anyone. This adds one admin per org
 * level on shared, plus-addressed F3 mailboxes, so nothing personal is
 * committed to this (public) repo and no real user's row is un-obfuscated:
 *
 *   admin@f3nation.com                 nation admin
 *   admin+<sector>@f3nation.com        sector admin   (e.g. admin+north-carolina)
 *   admin+<area>@f3nation.com          area admin     (e.g. admin+nc-mountain)
 *   admin+<region>@f3nation.com        region admin   (e.g. admin+boone)
 *   admin+<ao>@f3nation.com            AO admin       (first active AO, by name)
 *
 * The chain is read from the database: the named region, every ancestor
 * up to the nation (territory too, where one exists), and one of its AOs.
 *
 * Run it against STAGING after the obfuscated dump is loaded, never against
 * the intermediate copy: obfuscate-db:verify-target's email sweep would
 * (correctly) flag these addresses.
 *
 * Only a public.users row is needed. The auth app's Better Auth hook looks up
 * users by email and creates its own auth.better_auth_user shadow row on
 * first sign-in (apps/auth/src/lib/better-auth.ts, findF3UserId).
 *
 * Usage:
 *   DATABASE_URL=... pnpm -F @acme/scripts seed-staging-logins -- \
 *     --allow-db <database-name> [--region Boone]
 *
 * Re-running is safe: an existing user keeps its row and gains any missing
 * role.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

const MAILBOX = "admin";
const MAIL_DOMAIN = "f3nation.com";
const DEFAULT_REGION = "Boone";

interface Org {
  id: number;
  name: string;
  org_type: string;
  parent_id: number | null;
}

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** admin@ for the nation, admin+<org-slug>@ for everything below it. */
function loginEmail(org: Org): string {
  return org.org_type === "nation"
    ? `${MAILBOX}@${MAIL_DOMAIN}`
    : `${MAILBOX}+${slug(org.name)}@${MAIL_DOMAIN}`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const allowDb = flagValue("--allow-db");
  if (!allowDb) {
    throw new Error(
      "Refusing to run: pass --allow-db <name> naming the exact database to seed.",
    );
  }
  const urlDbName = databaseNameFromUrl(databaseUrl);
  if (urlDbName !== allowDb) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at database "${urlDbName}" but --allow-db is "${allowDb}".`,
    );
  }
  if (looksLikeProdDbName(allowDb)) {
    throw new Error(
      `Refusing to run: database name "${allowDb}" is (or looks like) production.`,
    );
  }
  const regionName = flagValue("--region") ?? DEFAULT_REGION;

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const [current] = await sql<{ db: string }[]>`
      SELECT current_database() AS db`;
    if (current?.db !== allowDb) {
      throw new Error(
        `Refusing to run: connected database is "${current?.db}" but --allow-db is "${allowDb}".`,
      );
    }

    // Fail closed on an ambiguous region rather than grant admin on the
    // wrong one.
    const regions = await sql<Org[]>`
      SELECT id, name, org_type::text AS org_type, parent_id FROM orgs
      WHERE org_type = 'region' AND lower(name) = lower(${regionName})`;
    if (regions.length !== 1) {
      throw new Error(
        `Expected exactly one region named "${regionName}", found ${regions.length}.`,
      );
    }
    const chain = await sql<Org[]>`
      WITH RECURSIVE up AS (
        SELECT id, name, org_type::text AS org_type, parent_id, 0 AS depth
        FROM orgs WHERE id = ${regions[0]!.id}
        UNION ALL
        SELECT o.id, o.name, o.org_type::text, o.parent_id, up.depth + 1
        FROM orgs o JOIN up ON o.id = up.parent_id)
      SELECT id, name, org_type, parent_id FROM up ORDER BY depth DESC`;
    if (chain[0]?.org_type !== "nation") {
      throw new Error(
        `"${regionName}" does not roll up to a nation org; refusing to guess.`,
      );
    }
    const [ao] = await sql<Org[]>`
      SELECT id, name, org_type::text AS org_type, parent_id FROM orgs
      WHERE org_type = 'ao' AND is_active AND parent_id = ${regions[0]!.id}
      ORDER BY name, id LIMIT 1`;
    const orgs = ao ? [...chain, ao] : chain;

    const [adminRole] = await sql<{ id: number }[]>`
      SELECT id FROM roles WHERE name = 'admin'`;
    if (!adminRole) throw new Error(`No "admin" row in roles`);

    await sql.begin(async (tx) => {
      for (const org of orgs) {
        const email = loginEmail(org);
        const [user] = await tx<{ id: number }[]>`
          INSERT INTO users (email, f3_name, first_name, last_name,
            email_verified)
          VALUES (${email}, ${`Staging Admin (${org.name})`}, 'Staging',
            ${`${org.org_type} admin`}, timezone('utc'::text, now()))
          ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
          RETURNING id`;
        if (!user) throw new Error(`Insert returned no row for ${email}`);
        await tx`
          INSERT INTO roles_x_users_x_org (role_id, user_id, org_id)
          SELECT ${adminRole.id}, ${user.id}, ${org.id}
          WHERE NOT EXISTS (
            SELECT 1 FROM roles_x_users_x_org
            WHERE role_id = ${adminRole.id} AND user_id = ${user.id}
              AND org_id = ${org.id})`;
        console.log(
          `  ✓ user ${user.id}: ${email} — admin of ${org.org_type} "${org.name}"`,
        );
      }
    });
    console.log(
      `Seeded ${orgs.length} staging admin login(s) in "${allowDb}". Sign in via email code at the staging auth app.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
