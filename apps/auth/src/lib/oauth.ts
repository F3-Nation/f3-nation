import crypto from "crypto";

import { and, eq, gt } from "@acme/db";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@acme/db/schema/schema";

import { db } from "~/lib/db";

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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
  const uris: string[] = JSON.parse(client.redirectUris);
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
  const code = generateToken();
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
  // Find the code
  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, params.code))
    .limit(1);

  if (!authCode) return { error: "invalid_grant" as const };
  if (new Date(authCode.expiresAt) < new Date())
    return { error: "invalid_grant" as const };
  if (authCode.clientId !== params.clientId)
    return { error: "invalid_grant" as const };
  if (authCode.redirectUri !== params.redirectUri)
    return { error: "invalid_grant" as const };

  // Validate client secret
  const client = await getClient(params.clientId);
  if (!client) return { error: "invalid_client" as const };
  if (!constantTimeEqual(client.clientSecret, params.clientSecret))
    return { error: "invalid_client" as const };

  // PKCE verification
  if (authCode.codeChallenge) {
    if (!params.codeVerifier) return { error: "invalid_grant" as const };

    let computedChallenge: string;
    if (authCode.codeChallengeMethod === "S256") {
      computedChallenge = crypto
        .createHash("sha256")
        .update(params.codeVerifier)
        .digest("base64url");
    } else {
      computedChallenge = params.codeVerifier;
    }

    if (computedChallenge !== authCode.codeChallenge)
      return { error: "invalid_grant" as const };
  }

  // Delete auth code (one-time use)
  await db
    .delete(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, params.code));

  // Create tokens
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const accessExpiresAt = new Date(
    Date.now() + 60 * 60 * 1000,
  ).toISOString(); // 1 hour
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString(); // 30 days

  await db.insert(oauthAccessTokens).values({
    token: accessToken,
    clientId: authCode.clientId,
    userId: authCode.userId,
    scopes: authCode.scopes,
    expiresAt: accessExpiresAt,
  });

  await db.insert(oauthRefreshTokens).values({
    token: refreshToken,
    clientId: authCode.clientId,
    userId: authCode.userId,
    expiresAt: refreshExpiresAt,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: 3600,
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
  if (!constantTimeEqual(client.clientSecret, params.clientSecret))
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

  // Delete old tokens (rotation)
  await db
    .delete(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.clientId, existing.clientId),
        eq(oauthAccessTokens.userId, existing.userId),
      ),
    );
  await db
    .delete(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.token, params.refreshToken));

  // Create new token pair
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const accessExpiresAt = new Date(
    Date.now() + 60 * 60 * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Look up scopes from previous access token or use client defaults
  const scopes = client.scopes ?? "openid profile email";

  await db.insert(oauthAccessTokens).values({
    token: accessToken,
    clientId: existing.clientId,
    userId: existing.userId,
    scopes,
    expiresAt: accessExpiresAt,
  });

  await db.insert(oauthRefreshTokens).values({
    token: refreshToken,
    clientId: existing.clientId,
    userId: existing.userId,
    expiresAt: refreshExpiresAt,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: scopes,
  };
}

// ---------------------------------------------------------------------------
// Token validation (for userinfo)
// ---------------------------------------------------------------------------

export async function validateAccessToken(token: string) {
  const [accessToken] = await db
    .select({
      token: oauthAccessTokens.token,
      userId: oauthAccessTokens.userId,
      scopes: oauthAccessTokens.scopes,
      expiresAt: oauthAccessTokens.expiresAt,
      clientId: oauthAccessTokens.clientId,
    })
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.token, token),
        gt(oauthAccessTokens.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!accessToken) return null;

  // Fetch user data
  const [user] = await db
    .select({
      id: users.id,
      f3Name: users.f3Name,
      email: users.email,
      emailVerified: users.emailVerified,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, accessToken.userId))
    .limit(1);

  if (!user) return null;

  return { ...accessToken, user };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

export async function revokeToken(token: string): Promise<void> {
  // Try access token first
  const [access] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, token))
    .limit(1);

  if (access) {
    await db
      .delete(oauthAccessTokens)
      .where(eq(oauthAccessTokens.token, token));
    return;
  }

  // Try refresh token — also delete associated access tokens
  const [refresh] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.token, token))
    .limit(1);

  if (refresh) {
    await db
      .delete(oauthAccessTokens)
      .where(
        and(
          eq(oauthAccessTokens.clientId, refresh.clientId),
          eq(oauthAccessTokens.userId, refresh.userId),
        ),
      );
    await db
      .delete(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.token, token));
  }
}
