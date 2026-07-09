import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  client_id?: string;
}

export type JwtVerificationFailureCode =
  | "expired"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "invalid_signature"
  | "invalid_claims"
  | "jwks_unavailable"
  | "invalid_token";

export type JwtVerificationResult<TPayload extends JWTPayload = JWTPayload> =
  | {
      ok: true;
      payload: TPayload;
    }
  | {
      ok: false;
      code: JwtVerificationFailureCode;
      message: string;
    };

export interface VerifyJwtWithJwksOptions {
  authServerUrl: string;
  issuer?: string;
  audience?: string;
  clientId?: string;
  skewSeconds?: number;
  allowClientIdClaimFallback?: boolean;
  jwksPath?: string;
}

const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JWKS_PATH = "/.well-known/jwks.json";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  const bytes =
    typeof atob === "function"
      ? Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
      : Buffer.from(padded, "base64");

  return new TextDecoder().decode(bytes);
}

export function parseJwtPayload(token: string): JWTPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payloadPart = parts[1];
  if (!payloadPart) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

export function isJwtExpired(
  token: string,
  skewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
): boolean {
  const payload = parseJwtPayload(token);
  if (typeof payload?.exp !== "number" || !Number.isFinite(payload.exp)) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
}

function getJwksResolver(options: VerifyJwtWithJwksOptions) {
  const authUrl = new URL(options.authServerUrl);
  const isLocalhost =
    authUrl.hostname === "localhost" || authUrl.hostname === "127.0.0.1";

  if (authUrl.protocol !== "https:" && !isLocalhost) {
    throw new Error("authServerUrl must use https:// outside localhost");
  }

  const jwksUrl = new URL(options.jwksPath ?? DEFAULT_JWKS_PATH, authUrl);
  const cacheKey = jwksUrl.toString();
  const existing = jwksCache.get(cacheKey);
  if (existing) return existing;

  const resolver = createRemoteJWKSet(jwksUrl);
  jwksCache.set(cacheKey, resolver);
  return resolver;
}

function classifyVerificationError(error: unknown): {
  code: JwtVerificationFailureCode;
  message: string;
} {
  if (!(error instanceof Error)) {
    return { code: "invalid_token", message: "Token verification failed" };
  }

  if (error.name === "JWTExpired") {
    return { code: "expired", message: "Token expired" };
  }

  if (error.name === "JWSSignatureVerificationFailed") {
    return {
      code: "invalid_signature",
      message: "Token signature verification failed",
    };
  }

  if (error.name === "JWTClaimValidationFailed") {
    const claim = (error as Error & { claim?: string }).claim;
    if (claim === "iss") {
      return { code: "issuer_mismatch", message: "Token issuer mismatch" };
    }
    if (claim === "aud") {
      return {
        code: "audience_mismatch",
        message: "Token audience mismatch",
      };
    }

    return { code: "invalid_claims", message: "Token claims are invalid" };
  }

  if (error.name === "TypeError" || /fetch|network/i.test(error.message)) {
    return {
      code: "jwks_unavailable",
      message: "Unable to reach JWKS endpoint",
    };
  }

  return { code: "invalid_token", message: "Token verification failed" };
}

export async function verifyJwtWithJwks<
  TPayload extends JWTPayload = JWTPayload,
>(
  token: string,
  options: VerifyJwtWithJwksOptions,
): Promise<JwtVerificationResult<TPayload>> {
  const skewSeconds = options.skewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const issuer = options.issuer ?? options.authServerUrl;
  const audience = options.audience ?? options.clientId;
  const allowClientIdClaimFallback = options.allowClientIdClaimFallback ?? true;

  if (isJwtExpired(token, skewSeconds)) {
    return { ok: false, code: "expired", message: "Token expired" };
  }

  let strictError: unknown;

  try {
    const { payload } = await jwtVerify(token, getJwksResolver(options), {
      algorithms: ["RS256"],
      issuer,
      ...(audience ? { audience } : {}),
    });

    return { ok: true, payload: payload as TPayload };
  } catch (error) {
    strictError = error;
  }

  if (allowClientIdClaimFallback && options.clientId) {
    try {
      const { payload } = await jwtVerify(token, getJwksResolver(options), {
        algorithms: ["RS256"],
        issuer,
      });

      if (payload.client_id !== options.clientId) {
        return {
          ok: false,
          code: "audience_mismatch",
          message: "Token client_id mismatch",
        };
      }

      return { ok: true, payload: payload as TPayload };
    } catch {
      // Preserve strict failure semantics for deterministic behavior.
    }
  }

  const classified = classifyVerificationError(strictError);
  return { ok: false, ...classified };
}

export async function verifyJwtPayload<
  TPayload extends JWTPayload = JWTPayload,
>(token: string, options: VerifyJwtWithJwksOptions): Promise<TPayload | null> {
  const result = await verifyJwtWithJwks<TPayload>(token, options);
  return result.ok ? result.payload : null;
}

export async function verifyJwtToken(
  token: string,
  options: VerifyJwtWithJwksOptions,
): Promise<boolean> {
  const result = await verifyJwtWithJwks(token, options);
  return result.ok;
}
