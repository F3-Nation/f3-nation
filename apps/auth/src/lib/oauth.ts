import crypto from "crypto";

import { and, eq, gt } from "@acme/db";
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@acme/db/schema/schema";
import { importJWK, jwtVerify } from "jose";

import { constantTimeEqual } from "~/lib/crypto-utils";
import { db } from "~/lib/db";
import { getJWKS, signAccessToken } from "~/lib/jwt";

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

// ---------------------------------------------------------------------------
// Client validation
// ---------------------------------------------------------------------------

export async function getClient(clientId: string) {
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.id, clientId), eq(oauthClients.isActive, true)))
    .limit(1);
  return client ?? null;
}

export function validateRedirectUri(
  client: typeof oauthClients.$inferSelect,
  redirectUri: string,
): boolean {
  let uris: unknown;
  try {
    uris = JSON.parse(client.redirectUris);
  } catch {
    return false;
  }
  if (!Array.isArray(uris)) return false;
  return uris.includes(redirectUri);
}

export function validateScopes(
  client: typeof oauthClients.$inferSelect,
  requestedScopes: string,
): boolean {
  const allowed = new Set((client.scopes ?? "openid profile email").split(" "));
  const requested = requestedScopes.split(" ");
  return requested.every((s) => allowed.has(s));
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export async function createAuthorizationCode(params: {
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): Promise<string> {
  const code = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId: params.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge ?? null,
    codeChallengeMethod: params.codeChallengeMethod ?? null,
    expiresAt,
  });

  return code;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier?: string;
}) {
  // Atomically consume the code (DELETE + RETURNING prevents TOCTOU races)
  const [authCode] = await db
    .delete(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, params.code))
    .returning();

  if (!authCode) return { error: "invalid_grant" as const };
  const expiresAt = authCode.expiresAt.endsWith("Z")
    ? new Date(authCode.expiresAt)
    : new Date(authCode.expiresAt + "Z");
  if (expiresAt < new Date()) return { error: "invalid_grant" as const };
  if (authCode.clientId !== params.clientId)
    return { error: "invalid_grant" as const };
  if (authCode.redirectUri !== params.redirectUri)
    return { error: "invalid_grant" as const };

  // Validate client secret (compare hash)
  const client = await getClient(params.clientId);
  if (!client) return { error: "invalid_client" as const };
  if (
    !constantTimeEqual(client.clientSecretHash, hashSecret(params.clientSecret))
  )
    return { error: "invalid_client" as const };

  // PKCE is required — reject codes that have no challenge stored (e.g. issued
  // before enforcement was in place) so there is no bypass window.
  if (!authCode.codeChallenge) return { error: "invalid_grant" as const };
  if (!params.codeVerifier) return { error: "invalid_grant" as const };

  const computedChallenge = crypto
    .createHash("sha256")
    .update(params.codeVerifier)
    .digest("base64url");

  if (!constantTimeEqual(computedChallenge, authCode.codeChallenge))
    return { error: "invalid_grant" as const };

  // Look up user email for JWT claims
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, authCode.userId))
    .limit(1);
  if (!user) return { error: "invalid_grant" as const };

  // Create tokens — access token is a JWT, refresh token is opaque
  const ACCESS_TOKEN_TTL = 3600; // 1 hour
  const accessToken = await signAccessToken({
    sub: authCode.userId,
    email: user.email,
    scope: authCode.scopes ?? "openid profile email",
    clientId: authCode.clientId,
    expiresInSeconds: ACCESS_TOKEN_TTL,
  });

  const refreshToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 30 days

  await db.insert(oauthRefreshTokens).values({
    token: refreshToken,
    clientId: authCode.clientId,
    userId: authCode.userId,
    expiresAt: refreshExpiresAt,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: authCode.scopes,
  };
}

// ---------------------------------------------------------------------------
// Refresh token exchange
// ---------------------------------------------------------------------------

export async function exchangeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) {
  // Validate client
  const client = await getClient(params.clientId);
  if (!client) return { error: "invalid_client" as const };
  if (
    !constantTimeEqual(client.clientSecretHash, hashSecret(params.clientSecret))
  )
    return { error: "invalid_client" as const };

  // Find refresh token
  const [existing] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(
      and(
        eq(oauthRefreshTokens.token, params.refreshToken),
        eq(oauthRefreshTokens.clientId, params.clientId),
        gt(oauthRefreshTokens.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!existing) return { error: "invalid_grant" as const };

  // Delete old refresh token (rotation)
  await db
    .delete(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.token, params.refreshToken));

  // Look up user email for JWT claims
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, existing.userId))
    .limit(1);
  if (!user) return { error: "invalid_grant" as const };

  const scopes = client.scopes ?? "openid profile email";
  const ACCESS_TOKEN_TTL = 3600; // 1 hour

  const accessToken = await signAccessToken({
    sub: existing.userId,
    email: user.email,
    scope: scopes,
    clientId: existing.clientId,
    expiresInSeconds: ACCESS_TOKEN_TTL,
  });

  const refreshToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.insert(oauthRefreshTokens).values({
    token: refreshToken,
    clientId: existing.clientId,
    userId: existing.userId,
    expiresAt: refreshExpiresAt,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: scopes,
  };
}

// ---------------------------------------------------------------------------
// Token validation (for userinfo)
// ---------------------------------------------------------------------------

export async function validateAccessToken(token: string) {
  // Verify JWT signature and expiry using our own public key
  const jwks = await getJWKS();
  const publicKey = await importJWK(jwks.keys[0]!, "RS256");

  let payload;
  try {
    const result = await jwtVerify(token, publicKey);
    payload = result.payload;
  } catch {
    return null;
  }

  const userId = Number(payload.sub);
  if (!userId) return null;

  // Fetch user data for userinfo endpoint
  const [user] = await db
    .select({
      id: users.id,
      f3Name: users.f3Name,
      email: users.email,
      emailVerified: users.emailVerified,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  return {
    token,
    userId,
    scopes: payload.scope as string | null,
    clientId: payload.client_id as string,
    user,
  };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

export async function revokeToken(token: string): Promise<void> {
  // JWT access tokens can't be revoked (they expire naturally).
  // Revoke refresh tokens to prevent new access tokens from being issued.
  const [refresh] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.token, token))
    .limit(1);

  if (refresh) {
    await db
      .delete(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.token, token));
  }
}

/**
 * Revoke all refresh tokens for a user. Called on logout so that
 * client apps can no longer obtain new access tokens on the user's behalf.
 * Existing access tokens (JWTs) will expire naturally within 1 hour.
 */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  await db
    .delete(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, userId));
}
