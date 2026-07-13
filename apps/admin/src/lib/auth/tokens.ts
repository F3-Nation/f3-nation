import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "~/env";

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  client_id?: string;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  if (typeof atob === "function") {
    return atob(padded);
  }

  return Buffer.from(padded, "base64").toString("utf-8");
}

function parseAccessTokenPayload(token: string): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadPart = parts[1];
  if (!payloadPart) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as Record<string, unknown>).sub !== "string"
    ) {
      return null;
    }

    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

function isAccessTokenExpired(token: string, skewSeconds = 60): boolean {
  const payload = parseAccessTokenPayload(token);
  if (typeof payload?.exp !== "number" || !Number.isFinite(payload.exp)) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
}

// ---------------------------------------------------------------------------
// RS256 signature verification via JWKS
// ---------------------------------------------------------------------------

// Lazily-initialised singleton — jose caches the JWKS response internally
// (default 15-minute TTL) so only the first request per cold-start hits the
// network.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRemoteJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const authUrl = new URL(env.AUTH_PROVIDER_URL);
    if (env.NODE_ENV === "production" && authUrl.protocol !== "https:") {
      throw new Error("AUTH_PROVIDER_URL must use HTTPS in production");
    }

    jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", authUrl));
  }

  return jwks;
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
  if (isAccessTokenExpired(token)) return null;

  const issuer = env.AUTH_PROVIDER_URL;
  const clientId = env.OAUTH_CLIENT_ID;

  // Resolved eagerly, outside the try/catch blocks below: a misconfigured
  // AUTH_PROVIDER_URL must throw loudly rather than being swallowed as a
  // routine verification failure, which would otherwise present as a silent,
  // undiagnosable re-auth loop for every user.
  const jwks = getRemoteJWKS();

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer,
      audience: clientId,
    });
    return parseAccessTokenPayloadFromClaims(payload);
  } catch {
    // Some tokens carry client_id instead of aud. Verify issuer/signature, then
    // assert the client claim below.
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer,
    });
    if (payload.client_id !== clientId) return null;
    return parseAccessTokenPayloadFromClaims(payload);
  } catch (err) {
    console.error("Access token verification failed", err);
    return null;
  }
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
