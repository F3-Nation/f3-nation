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
 * (the target table won't exist). One-time use: delete it once the cutover
 * is complete, tracked in #946.
 *
 * client_id is preserved exactly — every existing registration (apps/admin,
 * apps/me, Digital Weinke) keeps the same client_id it already has, so
 * nothing downstream needs to change its configured client_id when this
 * runs. client_secret is deliberately left unset for confidential clients,
 * NOT copied from oauth_clients.client_secret_hash: Better Auth's own
 * default secret hashing is preferred over matching the hand-rolled
 * server's sha256 scheme.
 *
 * Ownership: every migrated row gets referenceId = "f3-nation" and no
 * userId, so any current or future nation admin passes oauth-provider's
 * ownership check and can read and list it (see lib/oauth-client-reference.ts
 * and clientReference in better-auth.ts). Setting a real userId instead
 * would defeat that shared ownership, since oauth-provider checks userId
 * before referenceId — a client with a userId set is pinned to that one
 * individual, not any nation admin. This script writes the referenceId on
 * every row it inserts, and on already-present rows that have neither a
 * referenceId nor a userId. Rows pinned to a userId, or holding a different
 * referenceId, are reported and left alone.
 *
 * NOT solved here: a migrated confidential client (admin, me) has no secret
 * and is disabled, and rotating a secret is refused for a client with none
 * (see the rotate test in __tests__/lib/better-auth.test.ts). Issuing it a
 * secret and enabling it is separate provisioning work.
 *
 * Settings each new row gets, matching what relying parties do today:
 *   - offline_access is added to the client's scopes, since Better Auth only
 *     issues refresh tokens when it is granted (the hand-rolled server
 *     always issued one);
 *   - skipConsent, because there is no consent page (see consentPage in
 *     better-auth.ts) and the hand-rolled server never asked;
 *   - confidential clients authenticate with client_secret_post, which is
 *     what packages/sso sends; Better Auth rejects any other method than
 *     the one registered;
 *   - a link to the issuer resource (--resource, default NEXT_PUBLIC_AUTH_URL
 *     from the env file). Better Auth defaults every authorize and token
 *     request to that resource so access tokens are JWTs, and refuses a
 *     resource the client isn't linked to. Better Auth seeds the resource row
 *     itself on first start with AUTH_USE_BETTER_AUTH on; the script stops if
 *     it isn't there yet.
 * Rows already present from an earlier run keep their settings apart from
 * referenceId and the resource link; the script names any that differ.
 *
 * Usage:
 *   pnpm -C apps/auth migrate-oauth-clients-to-better-auth [--env local|staging|prod] [--resource <issuer>]
 *   (dry run by default — prints what would be inserted and which existing rows would get referenceId)
 *   pnpm -C apps/auth migrate-oauth-clients-to-better-auth --confirm
 *   (actually writes)
 */
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import postgres from "postgres";

import * as _schema from "@acme/db/schema/schema";

import { logError, logInfo, logWarn } from "../src/lib/logging";
import { F3_NATION_CLIENT_REFERENCE_ID } from "../src/lib/oauth-client-reference";

const {
  oauthClients,
  betterAuthOauthClient,
  betterAuthOauthClientResource,
  betterAuthOauthResource,
} = ("default" in _schema ? _schema.default : _schema) as typeof _schema;

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
  // Resolved relative to this script's own location, not the current
  // working directory: the documented invocation is `pnpm -C apps/auth
  // migrate-oauth-clients-to-better-auth`, but if someone runs it from the
  // repo root instead, a CWD-relative lookup would miss apps/auth/.env.
  const authDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const envName = targetEnv === "local" ? ".env" : `.env.${targetEnv}`;
  const envPath = path.join(authDir, envName);
  // override: true so --env's file always wins over whatever DATABASE_* the
  // calling shell already has set (e.g. a leftover prod export) — without
  // it, dotenv only fills in variables that aren't already present, so
  // --env local could silently connect using ambient prod credentials.
  const result = config({ path: envPath, override: true });
  if (result.error) {
    console.error(
      `Could not load ${envName}: ${result.error.message}` +
        (targetEnv === "local"
          ? "\nRun 'pnpm local:setup' (writes apps/auth/.env) first."
          : ""),
    );
    process.exit(1);
  }

  const resourceIndex = args.indexOf("--resource");
  const resource =
    resourceIndex !== -1
      ? args[resourceIndex + 1]
      : process.env.NEXT_PUBLIC_AUTH_URL;
  if (!resource || !URL.canParse(resource)) {
    logError("auth.migrate_oauth_clients.resource_not_given", {
      hint: "pass --resource <issuer URL> or set NEXT_PUBLIC_AUTH_URL in the env file",
    });
    process.exit(1);
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

  if (confirmed && (targetEnv === "prod" || targetEnv === "staging")) {
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
    // Matches packages/db/src/utils/functions.ts's existing ssl convention —
    // required for any non-local target.
    ssl: targetEnv === "local" ? false : "require",
  });
  const db = drizzle(sql);

  console.log(
    `\nConnected to ${targetEnv} database at ${databaseHost}/${databaseName}.\n`,
  );
  logInfo("auth.migrate_oauth_clients.linking_to_resource", { resource });

  const [resourceRow] = await db
    .select({ identifier: betterAuthOauthResource.identifier })
    .from(betterAuthOauthResource)
    .where(eq(betterAuthOauthResource.identifier, resource));
  if (!resourceRow) {
    logError("auth.migrate_oauth_clients.resource_missing", {
      resource,
      hint: "start the auth server once with AUTH_USE_BETTER_AUTH on (Better Auth seeds the resource), or check --resource",
    });
    await sql.end();
    process.exit(1);
  }

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

  const now = new Date();
  const rows = clients.map((client) => {
    let redirectUris: string[];
    try {
      const parsed: unknown = JSON.parse(client.redirectUris);
      if (
        !Array.isArray(parsed) ||
        !parsed.every((uri): uri is string => typeof uri === "string")
      ) {
        throw new Error("not a string array");
      }
      redirectUris = parsed;
    } catch {
      throw new Error(
        `oauth_clients.redirect_uris for "${client.id}" is not a valid JSON string array — fix that row before migrating.`,
      );
    }

    console.log(
      `  ${client.id} (${client.name}) — ${client.isPublic ? "public" : "confidential, migrating DISABLED — needs a secret issued before use, see file comment"}`,
    );

    const trimmedScopes = client.scopes?.trim();
    const scopeString =
      trimmedScopes && trimmedScopes.length > 0
        ? trimmedScopes
        : "openid profile email";
    const scopes = scopeString.split(/\s+/);
    // See the file comment: no refresh token without it.
    if (!scopes.includes("offline_access")) scopes.push("offline_access");

    return {
      id: crypto.randomUUID(),
      clientId: client.id, // preserved exactly — see file comment
      // No secret at all yet for confidential clients — see the file
      // comment's "OPEN QUESTION for Phase 4". Migrated disabled so it
      // can't be mistaken for a usable client until one is actually
      // issued; public clients need no secret, so they migrate active.
      clientSecret: null,
      disabled: !client.isPublic,
      // packages/sso sends the secret in the form body.
      tokenEndpointAuthMethod: client.isPublic ? "none" : "client_secret_post",
      applicationType: client.isPublic ? ("native" as const) : ("web" as const),
      // Every migrated client is F3-managed: this shared owner lets any nation
      // admin read and list it (see the file comment).
      referenceId: F3_NATION_CLIENT_REFERENCE_ID,
      requirePKCE: true, // matches the hand-rolled server's unconditional PKCE requirement
      // No consent page exists; the hand-rolled server never asked either.
      skipConsent: true,
      redirectUris,
      scopes,
      name: client.name,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code" as const],
      createdAt: now,
      updatedAt: now,
    };
  });

  // Computed once, ahead of both branches, so the dry-run count matches what
  // --confirm will actually insert -- rows already present get skipped in
  // both modes instead of being counted as "would be inserted" here.
  const alreadyPresent = await db
    .select({
      clientId: betterAuthOauthClient.clientId,
      referenceId: betterAuthOauthClient.referenceId,
      userId: betterAuthOauthClient.userId,
      skipConsent: betterAuthOauthClient.skipConsent,
      tokenEndpointAuthMethod: betterAuthOauthClient.tokenEndpointAuthMethod,
      scopes: betterAuthOauthClient.scopes,
    })
    .from(betterAuthOauthClient)
    .where(
      inArray(
        betterAuthOauthClient.clientId,
        rows.map((row) => row.clientId),
      ),
    );
  const alreadyPresentIds = new Set(alreadyPresent.map((row) => row.clientId));
  const newRows = rows.filter((row) => !alreadyPresentIds.has(row.clientId));
  // An already-present row without a referenceId (e.g. from an earlier run).
  // Stamp it unless it is pinned to an individual user (userId is checked
  // before referenceId, so setting one would change nothing and hide the
  // pin); those are only reported.
  const toStamp = alreadyPresent.filter(
    (row) => !row.referenceId && !row.userId,
  );
  // Rows nation admins still can't reach after this run: pinned to a user, or
  // holding some other referenceId. Reported, never overwritten.
  const needsReview = alreadyPresent.filter(
    (row) =>
      Boolean(row.userId) ||
      (Boolean(row.referenceId) &&
        row.referenceId !== F3_NATION_CLIENT_REFERENCE_ID),
  );
  for (const row of rows) {
    if (alreadyPresentIds.has(row.clientId)) {
      const existing = alreadyPresent.find((r) => r.clientId === row.clientId);
      console.log(
        existing?.userId
          ? `  Skipping ${row.clientId} — already present and owned by a user; left as is, needs manual review.`
          : existing?.referenceId &&
              existing.referenceId !== F3_NATION_CLIENT_REFERENCE_ID
            ? `  Skipping ${row.clientId} — already present with referenceId "${existing.referenceId}" (not "${F3_NATION_CLIENT_REFERENCE_ID}"); left as is, needs manual review.`
            : existing?.referenceId
              ? `  Skipping ${row.clientId} — already present.`
              : `  ${row.clientId} already present without an owner — will set referenceId.`,
      );
    }
  }
  // Rows from an earlier run of this script, which used other settings.
  for (const existing of alreadyPresent) {
    const row = rows.find((r) => r.clientId === existing.clientId);
    if (
      row &&
      (existing.skipConsent !== true ||
        existing.tokenEndpointAuthMethod !== row.tokenEndpointAuthMethod ||
        !existing.scopes?.includes("offline_access"))
    ) {
      logWarn("auth.migrate_oauth_clients.settings_incompatible", {
        clientId: existing.clientId,
        expectedAuthMethod: row.tokenEndpointAuthMethod,
        hint: "present without skipConsent, offline_access or the expected auth method; update it by hand (see file comment)",
      });
    }
  }

  const linked = await db
    .select({ clientId: betterAuthOauthClientResource.clientId })
    .from(betterAuthOauthClientResource)
    .where(
      and(
        eq(betterAuthOauthClientResource.resourceId, resource),
        inArray(
          betterAuthOauthClientResource.clientId,
          rows.map((row) => row.clientId),
        ),
      ),
    );
  const linkedIds = new Set(linked.map((row) => row.clientId));
  const reviewIds = new Set(needsReview.map((row) => row.clientId));
  const toLink = rows.filter(
    (row) => !linkedIds.has(row.clientId) && !reviewIds.has(row.clientId),
  );
  const reviewNote =
    needsReview.length > 0
      ? `\n${needsReview.length} existing row(s) need manual review: nation admins can't reach them.`
      : "";

  if (!confirmed) {
    console.log(
      `\nDry run only — ${newRows.length} row(s) would be inserted into better_auth_oauth_client` +
        ` and ${toStamp.length} existing row(s) would get referenceId;` +
        ` ${toLink.length} client(s) would be linked to ${resource}.`,
    );
    if (reviewNote) console.log(reviewNote);
    console.log("Re-run with --confirm to actually write.");
    await sql.end();
    return;
  }

  for (const row of newRows) {
    await db.insert(betterAuthOauthClient).values(row);
    console.log(`  Migrated ${row.clientId}.`);
  }

  for (const row of toStamp) {
    // Same condition that built toStamp, so a row changed since it was read is
    // not overwritten and not reported as set.
    const updated = await db
      .update(betterAuthOauthClient)
      .set({ referenceId: F3_NATION_CLIENT_REFERENCE_ID })
      .where(
        and(
          eq(betterAuthOauthClient.clientId, row.clientId),
          isNull(betterAuthOauthClient.referenceId),
          isNull(betterAuthOauthClient.userId),
        ),
      )
      .returning({ clientId: betterAuthOauthClient.clientId });
    console.log(
      updated.length === 1
        ? `  Set referenceId on ${row.clientId}.`
        : `  WARNING: ${row.clientId} was not updated (changed since it was read).`,
    );
  }

  for (const row of toLink) {
    await db.insert(betterAuthOauthClientResource).values({
      id: crypto.randomUUID(),
      clientId: row.clientId,
      resourceId: resource,
      createdAt: now,
    });
    logInfo("auth.migrate_oauth_clients.resource_link_created", {
      clientId: row.clientId,
      resource,
    });
  }

  if (reviewNote) console.log(reviewNote);
  console.log("\nDone.");
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
