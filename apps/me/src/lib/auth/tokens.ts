import { createRemoteJWKSet, jwtVerify } from "jose";

interface AccessTokenPayload {
  sub: string;
  email?: string;
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

export function parseAccessTokenPayload(
  token: string,
): AccessTokenPayload | null {
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

export function isAccessTokenExpired(token: string, skewSeconds = 60): boolean {
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
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRemoteJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    const base = process.env.AUTH_PROVIDER_URL;
    if (!base) throw new Error("AUTH_PROVIDER_URL is required");
    _jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", base));
  }
  return _jwks;
}

/**
 * Verify an access token's RS256 signature and expiry against the auth
 * server's JWKS endpoint.  Returns true only when both checks pass.
 *
 * Failures (invalid sig, expired, JWKS unavailable) all return false so the
 * caller can fall through to the token-refresh path.
 */
export async function verifyAccessToken(token: string): Promise<boolean> {
  // Fast pre-flight: skip the JWKS network call for obviously-expired tokens.
  if (isAccessTokenExpired(token)) return false;

  try {
    await jwtVerify(token, getRemoteJWKS(), { algorithms: ["RS256"] });
    return true;
  } catch {
    return false;
  }
}
