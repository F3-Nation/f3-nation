import {
  isAccessTokenPayload,
  isJwtExpired,
  parseJwtPayload,
  verifyJwtWithJwks,
} from "@acme/sso";
import type { AccessTokenPayload } from "@acme/sso";

import { env } from "@/env";
import { logError, logWarn } from "@/lib/logging";

export function parseAccessTokenPayload(
  token: string,
): AccessTokenPayload | null {
  const payload = parseJwtPayload(token);
  if (!isAccessTokenPayload(payload)) return null;
  return payload;
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
  try {
    const result = await verifyJwtWithJwks(token, {
      authServerUrl: env.AUTH_PROVIDER_URL,
      clientId: env.OAUTH_CLIENT_ID,
      allowClientIdClaimFallback: true,
    });

    if (!result.ok && result.code !== "expired") {
      if (
        result.code === "jwks_unavailable" ||
        result.code === "issuer_mismatch"
      ) {
        logError("me.auth.access_token_verify_failed", { code: result.code });
      } else {
        logWarn("me.auth.access_token_verify_failed", { code: result.code });
      }
    }

    return result.ok;
  } catch (err) {
    logError("me.auth.access_token_verify_misconfigured", {}, err);
    return false;
  }
}

/**
 * Verify an access token's RS256 signature and return the decoded claims on
 * success, or null on any failure (invalid sig, expired, JWKS unavailable).
 * Used by route handlers that need the payload after verifying (#371).
 */
export async function verifyAccessTokenPayload(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const result = await verifyJwtWithJwks<AccessTokenPayload>(token, {
      authServerUrl: env.AUTH_PROVIDER_URL,
      clientId: env.OAUTH_CLIENT_ID,
      allowClientIdClaimFallback: true,
    });

    if (!result.ok) {
      if (result.code !== "expired") {
        if (
          result.code === "jwks_unavailable" ||
          result.code === "issuer_mismatch"
        ) {
          logError("me.auth.access_token_payload_verify_failed", {
            code: result.code,
          });
        } else {
          logWarn("me.auth.access_token_payload_verify_failed", {
            code: result.code,
          });
        }
      }
      return null;
    }

    if (!isAccessTokenPayload(result.payload)) return null;
    return result.payload;
  } catch (err) {
    logError("me.auth.access_token_payload_verify_misconfigured", {}, err);
    return null;
  }
}
