import {
  
  isJwtExpired,
  parseJwtPayload,
  verifyJwtPayload,
  verifyJwtToken
} from "@acme/sso";
import type {AccessTokenPayload} from "@acme/sso";

import { env } from "@/env";

export function parseAccessTokenPayload(
  token: string,
): AccessTokenPayload | null {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.sub !== "string") return null;
  return payload as AccessTokenPayload;
}

export function isAccessTokenExpired(token: string, skewSeconds = 60): boolean {
  return isJwtExpired(token, skewSeconds);
}

/**
 * Verify an access token's RS256 signature and expiry against the auth
 * server's JWKS endpoint.  Returns true only when both checks pass.
 *
 * Failures (invalid sig, expired, JWKS unavailable) all return false so the
 * caller can fall through to the token-refresh path.
 */
export async function verifyAccessToken(token: string): Promise<boolean> {
  return verifyJwtToken(token, {
    authServerUrl: env.AUTH_PROVIDER_URL,
    clientId: env.OAUTH_CLIENT_ID,
  });
}

/**
 * Verify an access token's RS256 signature and return the decoded claims on
 * success, or null on any failure (invalid sig, expired, JWKS unavailable).
 * Used by route handlers that need the payload after verifying (#371).
 */
export async function verifyAccessTokenPayload(
  token: string,
): Promise<AccessTokenPayload | null> {
  const payload = await verifyJwtPayload<AccessTokenPayload>(token, {
    authServerUrl: env.AUTH_PROVIDER_URL,
    clientId: env.OAUTH_CLIENT_ID,
  });

  if (typeof payload?.sub !== "string") return null;
  return payload;
}
