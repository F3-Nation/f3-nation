/**
 * Seed sign-in identities into staging after an obfuscated refresh (F3-65).
 *
 * A refresh leaves staging with no way in: sessions are truncated and every
 * users.email is an unroutable @obfuscated.f3nation.dev address, so the auth
 * app's email-OTP can't deliver a code to anyone. This adds a few users with
 * routable addresses the operator names on the command line, so nothing real
 * is committed to this (public) repo and no real user's row is un-obfuscated.
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
 *     --allow-db <database-name> \
 *     --login you@example.com:admin [--login other@example.com:editor] ...
 *
 * Role is admin, editor, or none, granted on the nation-level org. Re-running
 * is safe: an existing user keeps its row and gains any missing role.
 */
import postgres from "postgres";

import { databaseNameFromUrl, looksLikeProdDbName } from "./db-url";

const OBFUSCATED_EMAIL_DOMAIN = "obfuscated.f3nation.dev";
const ROLES = ["admin", "editor", "none"] as const;
type Role = (typeof ROLES)[number];

interface Login {
  email: string;
  role: Role;
}

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx !== -1) return argv[idx + 1];
  return undefined;
}

function flagValues(name: string): string[] {
  const values: string[] = [];
  argv.forEach((a, i) => {
    if (a.startsWith(`${name}=`)) values.push(a.slice(name.length + 1));
    else if (a === name && argv[i + 1] !== undefined) values.push(argv[i + 1]!);
  });
  return values;
}

function parseLogin(raw: string): Login {
  const sep = raw.lastIndexOf(":");
  const email = (sep === -1 ? raw : raw.slice(0, sep)).trim().toLowerCase();
  const role = (sep === -1 ? "none" : raw.slice(sep + 1).trim()) as Role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`--login "${raw}": not an email address`);
  }
  if (email.endsWith(`@${OBFUSCATED_EMAIL_DOMAIN}`)) {
    throw new Error(
      `--login "${raw}": @${OBFUSCATED_EMAIL_DOMAIN} can't receive a sign-in code`,
    );
  }
  if (!ROLES.includes(role)) {
    throw new Error(
      `--login "${raw}": role must be one of ${ROLES.join(", ")}`,
    );
  }
  return { email, role };
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
  const logins = flagValues("--login").map(parseLogin);
  if (logins.length === 0) {
    throw new Error("Nothing to do: pass at least one --login <email>:<role>.");
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

    // Fail closed on an ambiguous nation org rather than grant admin on the
    // wrong one.
    const nations = await sql<{ id: number }[]>`
      SELECT id FROM orgs WHERE org_type = 'nation' ORDER BY id`;
    if (nations.length !== 1) {
      throw new Error(
        `Expected exactly one nation org, found ${nations.length}; refusing to guess which to grant roles on.`,
      );
    }
    const nationId = nations[0]!.id;
    const roleRows = await sql<{ id: number; name: string }[]>`
      SELECT id, name::text AS name FROM roles`;
    const roleIds = new Map(roleRows.map((r) => [r.name, r.id]));

    await sql.begin(async (tx) => {
      for (const login of logins) {
        const [user] = await tx<{ id: number }[]>`
          INSERT INTO users (email, f3_name, first_name, last_name,
            email_verified)
          VALUES (${login.email}, 'Staging Login', 'Staging', ${login.role},
            timezone('utc'::text, now()))
          ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
          RETURNING id`;
        if (!user) throw new Error(`Insert returned no row for a --login`);
        if (login.role !== "none") {
          const roleId = roleIds.get(login.role);
          if (roleId === undefined) {
            throw new Error(`No "${login.role}" row in roles`);
          }
          await tx`
            INSERT INTO roles_x_users_x_org (role_id, user_id, org_id)
            SELECT ${roleId}, ${user.id}, ${nationId}
            WHERE NOT EXISTS (
              SELECT 1 FROM roles_x_users_x_org
              WHERE role_id = ${roleId} AND user_id = ${user.id}
                AND org_id = ${nationId})`;
        }
        console.log(`  ✓ user ${user.id}: ${login.email} (${login.role})`);
      }
    });
    console.log(
      `Seeded ${logins.length} staging login(s) in "${allowDb}". Sign in via email code at the staging auth app.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
