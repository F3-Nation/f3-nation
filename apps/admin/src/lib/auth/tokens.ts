import { verifyJwtPayload } from "@acme/sso";
import type { JWTPayload } from "jose";

import { env } from "~/env";

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  client_id?: string;
}

/**
 * Verify an access token's RS256 signature and expiry against the auth
 * server's JWKS endpoint.  Returns true only when both checks pass.
 *
 * Failures (invalid sig, expired, JWKS unavailable) all return false so the
 * caller can fall through to the token-refresh path.
 */
export async function verifyAccessTokenPayload(
  token: string,
): Promise<AccessTokenPayload | null> {
  const payload = await verifyJwtPayload<AccessTokenPayload>(token, {
    authServerUrl: env.AUTH_PROVIDER_URL,
    clientId: env.OAUTH_CLIENT_ID,
  });

  return parseAccessTokenPayloadFromClaims(payload ?? {});
}

function parseAccessTokenPayloadFromClaims(
  payload: Record<string, unknown>,
): AccessTokenPayload | null {
  if (typeof payload.sub !== "string") return null;

  return {
    ...payload,
    sub: payload.sub,
  };
}
