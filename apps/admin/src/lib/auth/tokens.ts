import type { AccessTokenPayload } from "@acme/sso";
import { isAccessTokenPayload, verifyJwtWithJwks } from "@acme/sso";

import { env } from "~/env";
import { logError, logWarn } from "~/lib/logging";

/**
 * Verify an access token's RS256 signature and return decoded claims on
 * success, or null on any verification failure.
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
          logError("admin.auth.access_token_payload_verify_failed", {
            code: result.code,
          });
        } else {
          logWarn("admin.auth.access_token_payload_verify_failed", {
            code: result.code,
          });
        }
      }
      return null;
    }

    return parseAccessTokenPayloadFromClaims(result.payload);
  } catch (err) {
    logError("admin.auth.access_token_payload_verify_misconfigured", {}, err);
    return null;
  }
}

function parseAccessTokenPayloadFromClaims(
  payload: Record<string, unknown> | null | undefined,
): AccessTokenPayload | null {
  if (!payload || !isAccessTokenPayload(payload)) return null;

  return {
    ...payload,
    sub: payload.sub,
  };
}
