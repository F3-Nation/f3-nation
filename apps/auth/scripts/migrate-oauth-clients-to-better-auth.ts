#!/usr/bin/env tsx
/**
 * One-time data migration: copy every active row from `oauth_clients` (the
 * hand-rolled server's client registry) into `better_auth_oauth_client`
 * (the #876 Phase 3 Better Auth instance's own registry — see
 * apps/auth/src/lib/better-auth.ts and the schema drafted in
 * packages/db/drizzle/schema.ts).
 *
 * NOT run by anything — this is a script a human runs deliberately, after
 * the better_auth_* migration itself has been reviewed and applied (see the
 * "DRAFTED, NOT APPLIED" block comment in packages/db/drizzle/schema.ts).
 * Running this script before that migration is applied will fail outright
 * (the target table won't exist).
 *
 * client_id is preserved exactly — every existing registration (apps/admin,
 * apps/me, Digital Weinke) keeps the same client_id it already has, so
 * nothing downstream needs to change its configured client_id when this
 * runs. client_secret is deliberately left unset for confidential clients,
 * NOT copied from oauth_clients.client_secret_hash: team decision (#876
 * thread, 2026-08-28) to prefer Better Auth's own default secret hashing
 * over matching the hand-rolled server's sha256 scheme.
 *
 * OPEN QUESTION for Phase 4, not solved by this script: how a migrated
 * confidential client (admin, me) actually gets a new secret issued.
 * oauth-provider's only secret-issuing paths are adminCreateOAuthClient
 * (mints a brand new client_id — breaks the continuity this script exists
 * to preserve) and rotateClientSecret (session-scoped, checked against the
 * client's userId — a migrated row has none, since it was never created via
 * a real user's dynamic registration). Neither is a clean "admin sets a
 * secret on an existing, unowned client" operation. Needs a decision before
 * cutover: e.g. set a real userId on migrated confidential clients so
 * rotateClientSecret's ownership check passes, or a small server-only
 * wrapper added alongside admin-create/update in apps/auth/src/lib/
 * better-auth.ts.
 *
 * Usage:
 *   pnpm -C apps/auth migrate-oauth-clients-to-better-auth [--env local|staging|prod]
 *   (dry run by default — prints what would be inserted)
 *   pnpm -C apps/auth migrate-oauth-clients-to-better-auth --confirm
 *   (actually writes)
 */
import readline from "readline";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as _schema from "@acme/db/schema/schema";

const { oauthClients, betterAuthOauthClient } = (
  "default" in _schema ? _schema.default : _schema
) as typeof _schema;

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf("--env");
  const targetEnv = envIndex !== -1 ? args[envIndex + 1] : "local";
  const confirmed = args.includes("--confirm");

  if (!targetEnv || !["local", "staging", "prod"].includes(targetEnv)) {
    console.error("Invalid --env. Use: local, staging, or prod");
    process.exit(1);
  }

  const { config } = await import("dotenv");
  if (targetEnv === "local") {
    config({ path: "../../.env" });
  } else {
    config({ path: `.env.${targetEnv}` });
  }

  const databaseHost = process.env.DATABASE_HOST;
  const databasePort = parseInt(process.env.DATABASE_PORT ?? "5432", 10);
  const databaseUser = process.env.DATABASE_USER;
  const databasePassword = process.env.DATABASE_PASSWORD;
  const databaseName = process.env.DATABASE_NAME;

  if (!databaseHost || !databaseUser || !databasePassword || !databaseName) {
    console.error(
      "Missing one or more required database env vars: DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME",
    );
    process.exit(1);
  }

  if (targetEnv === "prod" || targetEnv === "staging") {
    console.log(
      `\n⚠️  WARNING: You are about to write to ${targetEnv.toUpperCase()} data.\n`,
    );
    const answer = await ask("Are you sure you want to continue? (y/N): ");
    if (answer.toLowerCase() !== "y") process.exit(0);
  }

  const sql = postgres({
    host: databaseHost,
    port: databasePort,
    user: databaseUser,
    password: databasePassword,
    database: databaseName,
  });
  const db = drizzle(sql);

  console.log(
    `\nConnected to ${targetEnv} database at ${databaseHost}/${databaseName}.\n`,
  );

  const clients = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.isActive, true));

  if (clients.length === 0) {
    console.log("No active oauth_clients rows found. Nothing to do.");
    await sql.end();
    return;
  }

  console.log(`Found ${clients.length} active client(s) in oauth_clients:\n`);

  const now = new Date().toISOString();
  const rows = clients.map((client) => {
    let redirectUris: string[];
    try {
      redirectUris = JSON.parse(client.redirectUris) as string[];
    } catch {
      throw new Error(
        `oauth_clients.redirect_uris for "${client.id}" is not valid JSON — fix that row before migrating.`,
      );
    }

    console.log(
      `  ${client.id} (${client.name}) — ${client.isPublic ? "public" : "confidential, migrating DISABLED — needs a secret issued before use, see file comment"}`,
    );

    return {
      id: crypto.randomUUID(),
      clientId: client.id, // preserved exactly — see file comment
      // No secret at all yet for confidential clients — see the file
      // comment's "OPEN QUESTION for Phase 4". Migrated disabled so it
      // can't be mistaken for a usable client until one is actually
      // issued; public clients need no secret, so they migrate active.
      clientSecret: null,
      disabled: !client.isPublic,
      tokenEndpointAuthMethod: client.isPublic ? "none" : "client_secret_basic",
      applicationType: client.isPublic ? ("native" as const) : ("web" as const),
      requirePKCE: true, // matches the hand-rolled server's unconditional PKCE requirement
      redirectUris,
      scopes: (client.scopes ?? "openid profile email").split(" "),
      name: client.name,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code" as const],
      createdAt: now,
      updatedAt: now,
    };
  });

  if (!confirmed) {
    console.log(
      `\nDry run only — ${rows.length} row(s) would be inserted into better_auth_oauth_client.`,
    );
    console.log("Re-run with --confirm to actually write.");
    await sql.end();
    return;
  }

  for (const row of rows) {
    const [existing] = await db
      .select({ clientId: betterAuthOauthClient.clientId })
      .from(betterAuthOauthClient)
      .where(eq(betterAuthOauthClient.clientId, row.clientId))
      .limit(1);
    if (existing) {
      console.log(
        `  Skipping ${row.clientId} — already present in better_auth_oauth_client.`,
      );
      continue;
    }
    await db.insert(betterAuthOauthClient).values(row);
    console.log(`  Migrated ${row.clientId}.`);
  }

  console.log("\nDone.");
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
