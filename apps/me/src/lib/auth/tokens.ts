import type { AccessTokenPayload } from "@acme/sso";
import * as sso from "@acme/sso";

import { env } from "@/env";
import { logWarn } from "@/lib/logging";

export function parseAccessTokenPayload(
  token: string,
): AccessTokenPayload | null {
  const payload = sso.parseJwtPayload(token);
  if (!sso.isAccessTokenPayload(payload)) return null;
  return payload;
}

export function isAccessTokenExpired(token: string, skewSeconds = 60): boolean {
  return sso.isJwtExpired(token, skewSeconds);
}

/**
 * Verify an access token's RS256 signature and expiry against the auth
 * server's JWKS endpoint.  Returns true only when both checks pass.
 *
 * Failures (invalid sig, expired, JWKS unavailable) all return false so the
 * caller can fall through to the token-refresh path.
 */
export async function verifyAccessToken(token: string): Promise<boolean> {
  const result = await sso.verifyAccessToken(
    token,
    env.AUTH_PROVIDER_URL,
    env.OAUTH_CLIENT_ID,
    true,
  );

  if (!result.ok) {
    logWarn("me.auth.access_token_verify_failed", {
      code: result.code ?? "misconfigured",
      message: result.error,
    });
  }

  return result.ok;
}

/**
 * Verify an access token's RS256 signature and return the decoded claims on
 * success, or null on any failure (invalid sig, expired, JWKS unavailable).
 * Used by route handlers that need the payload after verifying (#371).
 */
export async function verifyAccessTokenPayload(
  token: string,
): Promise<AccessTokenPayload | null> {
  const result = await sso.verifyJwtWithJwks<AccessTokenPayload>(token, {
    authServerUrl: env.AUTH_PROVIDER_URL,
    clientId: env.OAUTH_CLIENT_ID,
    allowClientIdClaimFallback: true,
  });

  if (!result.ok) {
    return null;
  }

  if (!sso.isAccessTokenPayload(result.payload)) return null;
  return result.payload;
}
