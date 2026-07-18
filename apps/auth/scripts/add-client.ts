#!/usr/bin/env tsx
/**
 * Interactive CLI script for registering and updating OAuth clients.
 *
 * Usage:
 *   pnpm -C apps/auth add-client              # local (default)
 *   pnpm -C apps/auth add-client --env staging
 *   pnpm -C apps/auth add-client --env prod   # prompts for confirmation
 */

import crypto from "crypto";
import readline from "readline";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as _schema from "@acme/db/schema/schema";

// CJS/ESM interop: when loaded as CJS, named exports are under .default
const { oauthClients } = (
  "default" in _schema ? _schema.default : _schema
) as typeof _schema;

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/N): `);
  return answer.toLowerCase() === "y";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CLIENT_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function isValidClientId(id: string): boolean {
  return CLIENT_ID_REGEX.test(id) && id.length >= 3;
}

function isValidRedirectUri(uri: string, isPublic: boolean): boolean {
  try {
    const parsed = new URL(uri);
    if (
      parsed.protocol === "https:" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1"
    ) {
      return true;
    }
    // Public clients (native apps) may register a private-use / custom
    // scheme redirect, e.g. com.example.app:/oauth2redirect (RFC 8252 §7.1).
    // The scheme must be reverse-domain (contain a dot) AND have NO authority
    // component — RFC 8252 §7.1 uses `scheme:/path`, not `scheme://host/...`.
    // Rejecting an authority closes off spoofed forms like
    // `com.example.app://attacker/callback`.
    if (isPublic) {
      const scheme = parsed.protocol.replace(/:$/, "");
      return scheme.includes(".") && parsed.host === "";
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf("--env");
  const targetEnv = envIndex !== -1 ? args[envIndex + 1] : "local";

  if (!targetEnv || !["local", "staging", "prod"].includes(targetEnv)) {
    console.error("Invalid --env. Use: local, staging, or prod");
    process.exit(1);
  }

  // Load individual DB env vars from appropriate env file
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

  if (targetEnv === "prod") {
    console.log("\n⚠️  WARNING: You are modifying PRODUCTION data.\n");
    if (!(await confirm("Are you sure you want to continue?"))) {
      process.exit(0);
    }
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

  // Step 1: Client name
  const clientName = await ask("Client name: ");
  if (!clientName.trim()) {
    console.error("Client name is required.");
    process.exit(1);
  }

  // Check if client exists by name
  const [existing] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.name, clientName.trim()))
    .limit(1);

  let isUpdate = false;

  if (existing) {
    console.log(`\nClient "${clientName}" already exists:`);
    console.log(`  ID:            ${existing.id}`);
    console.log(`  Redirect URIs: ${existing.redirectUris}`);
    console.log(`  Origin:        ${existing.allowedOrigin}`);
    console.log(`  Scopes:        ${existing.scopes}`);
    console.log(`  Active:        ${existing.isActive}`);
    console.log(`  Public:        ${existing.isPublic}`);
    console.log();

    if (!(await confirm("Update this client and regenerate secret?"))) {
      process.exit(0);
    }
    isUpdate = true;
  }

  let clientId: string;
  let redirectUris: string[];
  let allowedOrigin: string;
  let scopes: string;
  let isPublic: boolean;

  if (isUpdate && existing) {
    clientId = existing.id;
    redirectUris = JSON.parse(existing.redirectUris) as string[];
    allowedOrigin = existing.allowedOrigin;
    scopes = existing.scopes ?? "openid profile email";
    isPublic = existing.isPublic;

    // Allow editing
    const newUris = await ask(`Redirect URIs [${redirectUris.join(", ")}]: `);
    if (newUris.trim()) {
      redirectUris = newUris.split(",").map((u) => u.trim());
      for (const uri of redirectUris) {
        if (!isValidRedirectUri(uri, isPublic)) {
          console.error(
            `Invalid redirect URI: ${uri}. Must be HTTPS or localhost` +
              (isPublic ? " or a custom scheme (public client)." : "."),
          );
          process.exit(1);
        }
      }
    }

    const newOrigin = await ask(`Allowed origin [${allowedOrigin}]: `);
    if (newOrigin.trim()) allowedOrigin = newOrigin.trim();

    const newScopes = await ask(`Scopes [${scopes}]: `);
    if (newScopes.trim()) scopes = newScopes.trim();
  } else {
    // New client
    const rawId = await ask(
      "Client ID (slug, or press Enter to auto-generate): ",
    );
    if (rawId.trim()) {
      if (!isValidClientId(rawId.trim())) {
        console.error(
          "Invalid client ID. Use lowercase alphanumeric with hyphens, at least 3 chars.",
        );
        process.exit(1);
      }

      // Check uniqueness
      const [dup] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.id, rawId.trim()))
        .limit(1);
      if (dup) {
        console.error(`Client ID "${rawId.trim()}" already exists.`);
        process.exit(1);
      }
      clientId = rawId.trim();
    } else {
      clientId = crypto.randomBytes(16).toString("hex");
    }

    isPublic = await confirm(
      "Public client? (native/mobile app that cannot keep a client_secret; " +
        "token exchange uses PKCE only)",
    );

    const rawUris = await ask("Redirect URIs (comma-separated): ");
    redirectUris = rawUris
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (redirectUris.length === 0) {
      console.error("At least one redirect URI is required.");
      process.exit(1);
    }
    for (const uri of redirectUris) {
      if (!isValidRedirectUri(uri, isPublic)) {
        console.error(
          `Invalid redirect URI: ${uri}. Must be HTTPS or localhost` +
            (isPublic
              ? " or a custom scheme like com.example.app:/callback (public client)."
              : "."),
        );
        process.exit(1);
      }
    }

    allowedOrigin = await ask("Allowed origin (CORS): ");
    if (!allowedOrigin.trim()) {
      console.error("Allowed origin is required.");
      process.exit(1);
    }
    allowedOrigin = allowedOrigin.trim();

    const rawScopes = await ask("Scopes [openid profile email]: ");
    scopes = rawScopes.trim() || "openid profile email";
  }

  // Generate new secret and hash it. Public clients get a random unusable
  // hash (never revealed): the column is NOT NULL, but token exchange for
  // public clients never consults it — they authenticate via PKCE.
  const clientSecret = crypto.randomBytes(32).toString("base64url");
  const clientSecretHash = crypto
    .createHash("sha256")
    .update(
      isPublic ? crypto.randomBytes(32).toString("base64url") : clientSecret,
    )
    .digest("hex");

  // Review
  console.log("\n--- Review ---");
  console.log(`  Name:          ${clientName.trim()}`);
  console.log(`  ID:            ${clientId}`);
  console.log(`  Redirect URIs: ${JSON.stringify(redirectUris)}`);
  console.log(`  Origin:        ${allowedOrigin}`);
  console.log(`  Scopes:        ${scopes}`);
  console.log(`  Public:        ${isPublic}`);
  console.log();

  if (!(await confirm("Save this client?"))) {
    process.exit(0);
  }

  if (isUpdate) {
    await db
      .update(oauthClients)
      .set({
        clientSecretHash,
        redirectUris: JSON.stringify(redirectUris),
        allowedOrigin,
        scopes,
        isPublic,
      })
      .where(eq(oauthClients.id, clientId));
  } else {
    await db.insert(oauthClients).values({
      id: clientId,
      name: clientName.trim(),
      clientSecretHash,
      redirectUris: JSON.stringify(redirectUris),
      allowedOrigin,
      scopes,
      isPublic,
    });
  }

  console.log("\n✅ Client saved successfully!\n");
  console.log(`  Client ID:     ${clientId}`);
  if (isPublic) {
    console.log("  Client Secret: (none — public client, PKCE only)");
  } else {
    console.log(`  Client Secret: ${clientSecret}`);
    console.log("\n⚠️  Save the secret now — it cannot be retrieved later.");
  }
  console.log();

  rl.close();
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
