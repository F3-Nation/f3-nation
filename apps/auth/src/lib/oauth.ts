import crypto from "crypto";

import { and, eq, gt, isNotNull, isNull, lt } from "@acme/db";
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
import { logError, logWarn } from "~/lib/logging";

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

// A losing request in a genuine race (two overlapping refresh calls on the
// same original token — a client-side retry, overlapping tabs/processes)
// lands in the same "already rotated" path as a real replay: its own
// UPDATE ... WHERE rotatedAt IS NULL finds nothing because the winner claimed
// the row first. Without this window, that race would be indistinguishable
// from theft and would revoke the winner's freshly-issued token too,
// stranding a legitimate session. 10s is generous enough to absorb normal
// request jitter/retries without meaningfully weakening replay detection —
// an attacker replaying a stolen-then-rotated token is realistically doing
// so well after the legitimate rotation, not within the same window.
const REPLAY_GRACE_WINDOW_MS = 10_000;

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
  clientSecret?: string;
  redirectUri: string;
  codeVerifier?: string;
}) {
  const reject = (
    reason: string,
    error: "invalid_grant" | "invalid_client" = "invalid_grant",
  ) => {
    logWarn("auth.oauth.token_rejected", {
      clientId: params.clientId,
      grantType: "authorization_code",
      reason,
    });
    return { error };
  };

  // Atomically consume the code (DELETE + RETURNING prevents TOCTOU races)
  const [authCode] = await db
    .delete(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, params.code))
    .returning();

  if (!authCode) return reject("code_not_found");
  if (new Date(authCode.expiresAt) < new Date()) return reject("code_expired");
  if (authCode.clientId !== params.clientId) return reject("client_mismatch");
  if (authCode.redirectUri !== params.redirectUri)
    return reject("redirect_uri_mismatch");

  // Validate client authentication.
  // Confidential clients (default) must present the client secret.
  // Public clients (RFC 8252 native/mobile apps, is_public = true) cannot
  // keep a secret confidential, so they authenticate with PKCE alone —
  // which is enforced unconditionally below for all client types.
  const client = await getClient(params.clientId);
  if (!client) return reject("unknown_client", "invalid_client");
  if (!client.isPublic) {
    if (!params.clientSecret)
      return reject("missing_client_secret", "invalid_client");
    if (
      !constantTimeEqual(
        client.clientSecretHash,
        hashSecret(params.clientSecret),
      )
    )
      return reject("invalid_client_secret", "invalid_client");
  } else if (params.clientSecret) {
    // Protocol anomaly (RFC 6749 §2.3): a public client should never present
    // a secret. Not fatal — PKCE is still enforced below — but worth a
    // signal in case the client is misconfigured or a DB flip mislabeled it.
    logWarn("auth.oauth.public_client_sent_secret", {
      clientId: params.clientId,
    });
  }

  // PKCE is required — reject codes that have no challenge stored (e.g. issued
  // before enforcement was in place) so there is no bypass window.
  if (!authCode.codeChallenge) return reject("missing_code_challenge");
  if (!params.codeVerifier) return reject("missing_code_verifier");

  const computedChallenge = crypto
    .createHash("sha256")
    .update(params.codeVerifier)
    .digest("base64url");

  if (!constantTimeEqual(computedChallenge, authCode.codeChallenge))
    return reject("pkce_verifier_mismatch");

  // Look up user email for JWT claims
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, authCode.userId))
    .limit(1);
  if (!user) {
    // The code's userId came straight from a FK-constrained insert, so a
    // missing user here means backend data corruption, not a client error.
    logError("auth.oauth.user_not_found", {
      clientId: params.clientId,
      grantType: "authorization_code",
      userId: authCode.userId,
    });
    return { error: "invalid_grant" as const };
  }

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
  clientSecret?: string;
}) {
  const reject = (
    reason: string,
    error: "invalid_grant" | "invalid_client" = "invalid_grant",
  ) => {
    logWarn("auth.oauth.token_rejected", {
      clientId: params.clientId,
      grantType: "refresh_token",
      reason,
    });
    return { error };
  };

  // Validate client. Public clients skip the secret check (see
  // exchangeAuthorizationCode); their refresh grant is protected by
  // possession of the (single-use, rotated-below) refresh token itself,
  // per RFC 6749 §6 + RFC 8252 §8.2 guidance for native apps.
  const client = await getClient(params.clientId);
  if (!client) return reject("unknown_client", "invalid_client");
  if (!client.isPublic) {
    if (!params.clientSecret)
      return reject("missing_client_secret", "invalid_client");
    if (
      !constantTimeEqual(
        client.clientSecretHash,
        hashSecret(params.clientSecret),
      )
    )
      return reject("invalid_client_secret", "invalid_client");
  } else if (params.clientSecret) {
    // See matching comment in exchangeAuthorizationCode — not fatal, PKCE
    // rotation is still the real credential here, but worth a signal.
    logWarn("auth.oauth.public_client_sent_secret", {
      clientId: params.clientId,
    });
  }

  // Consume + reissue inside one transaction: if signing or the new-row
  // insert throws after the old refresh token is deleted, the whole thing
  // rolls back instead of leaving the caller's session burned with nothing
  // to show for it (this is the client's *only* credential for public
  // clients, so a half-completed rotation would strand them at re-login).
  return db.transaction(async (tx) => {
    const nowIso = new Date().toISOString();

    // Soft-consume: an UPDATE that stamps rotatedAt, instead of a DELETE,
    // keeps the row around as evidence for the replay check below (RFC 9700
    // §4.14.2) — a hard DELETE would erase it, making a replayed
    // already-rotated token indistinguishable from one that never existed.
    // isNull(rotatedAt) gives this the same single-use atomicity a
    // DELETE...RETURNING would: only one concurrent UPDATE can flip a NULL
    // rotatedAt to non-null and get the row back, mirroring the
    // authorization-code consumption above. Rotated rows now accumulate
    // instead of being deleted — see cleanupRotatedRefreshTokens below,
    // which needs a scheduler wired up to actually run periodically (none
    // exists yet in this app).
    const [existing] = await tx
      .update(oauthRefreshTokens)
      .set({ rotatedAt: nowIso })
      .where(
        and(
          eq(oauthRefreshTokens.token, params.refreshToken),
          eq(oauthRefreshTokens.clientId, params.clientId),
          isNull(oauthRefreshTokens.rotatedAt),
          gt(oauthRefreshTokens.expiresAt, nowIso),
        ),
      )
      .returning();

    if (!existing) {
      // Tell an unknown/garbage token apart from a REPLAY of one already
      // rotated away — only the latter still has a row with rotatedAt set.
      // A replay is treated as a compromise signal: revoke every refresh
      // token for this user+client (including the legitimate rotated
      // descendant) so a stolen-then-rotated token can't keep working, per
      // RFC 9700 §4.14.2 — this matters most for public clients, where
      // rotation is the *only* theft mitigation (no secret as a second
      // factor).
      const [reused] = await tx
        .select({
          userId: oauthRefreshTokens.userId,
          rotatedAt: oauthRefreshTokens.rotatedAt,
        })
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.token, params.refreshToken),
            eq(oauthRefreshTokens.clientId, params.clientId),
            isNotNull(oauthRefreshTokens.rotatedAt),
          ),
        )
        .limit(1);
      if (reused) {
        const rotatedMsAgo = Date.now() - new Date(reused.rotatedAt!).getTime();
        if (rotatedMsAgo <= REPLAY_GRACE_WINDOW_MS) {
          // Within the grace window: treat as a concurrent-request race, not
          // theft. Reject only this request — the winner's new token (and
          // the rest of the family) stays intact.
          logWarn("auth.oauth.refresh_token_concurrent_reuse", {
            clientId: params.clientId,
            userId: reused.userId,
          });
        } else {
          logWarn("auth.oauth.refresh_token_reuse_detected", {
            clientId: params.clientId,
            userId: reused.userId,
          });
          await tx
            .delete(oauthRefreshTokens)
            .where(
              and(
                eq(oauthRefreshTokens.userId, reused.userId),
                eq(oauthRefreshTokens.clientId, params.clientId),
              ),
            );
        }
      }
      return reject("refresh_token_invalid_or_expired");
    }

    // Look up user email for JWT claims
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1);
    if (!user) {
      logError("auth.oauth.user_not_found", {
        clientId: params.clientId,
        grantType: "refresh_token",
        userId: existing.userId,
      });
      return { error: "invalid_grant" as const };
    }

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

    await tx.insert(oauthRefreshTokens).values({
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
  });
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

// Rows only ever accumulate rotatedAt via the soft-consume in
// exchangeRefreshToken (see above) — they're never deleted at rotation time
// so a replayed token can still be recognized. Nothing calls this on a
// schedule yet; this app has no cron/job runner today. Wire it up to
// whatever gets adopted (Vercel Cron, a scheduled GitHub Actions workflow,
// etc.) rather than leaving auth.oauth_refresh_tokens to grow unbounded.
const ROTATED_TOKEN_RETENTION_DAYS = 30;

export async function cleanupRotatedRefreshTokens(): Promise<number> {
  const cutoff = new Date(
    Date.now() - ROTATED_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const deleted = await db
    .delete(oauthRefreshTokens)
    .where(
      and(
        isNotNull(oauthRefreshTokens.rotatedAt),
        lt(oauthRefreshTokens.rotatedAt, cutoff),
      ),
    )
    .returning({ token: oauthRefreshTokens.token });
  return deleted.length;
}
