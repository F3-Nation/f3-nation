import type { AccessTokenPayload } from "@acme/sso";
import * as sso from "@acme/sso";

import { env } from "~/env";
import { logWarn } from "~/lib/logging";

export async function verifyAccessToken(token: string): Promise<boolean> {
  const result = await sso.verifyAccessToken(
    token,
    env.AUTH_PROVIDER_URL,
    env.OAUTH_CLIENT_ID,
    true,
  );

  if (!result.ok) {
    logWarn("admin.auth.access_token_verify_failed", {
      code: result.code ?? "misconfigured",
      message: result.error,
    });
  }

  return result.ok;
}

/**
 * Verify an access token's RS256 signature and return decoded claims on
 * success, or null on any verification failure.
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

  return parseAccessTokenPayloadFromClaims(result.payload);
}

function parseAccessTokenPayloadFromClaims(
  payload: Record<string, unknown> | null | undefined,
): AccessTokenPayload | null {
  if (!payload || !sso.isAccessTokenPayload(payload)) return null;

  return {
    ...payload,
    sub: payload.sub,
  };
}
