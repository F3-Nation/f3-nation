import { exportJWK, importPKCS8, SignJWT } from "jose";
import type { JWK } from "jose";

import { env } from "~/env";

let _privateKey: CryptoKey | null = null;
let _jwks: { keys: JWK[] } | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (!_privateKey) {
    const pem = env.AUTH_JWT_PRIVATE_KEY.replace(/\\n/g, "\n");
    _privateKey = await importPKCS8(pem, "RS256", {
      extractable: true,
    });
  }
  return _privateKey;
}

/**
 * Return the JWKS document (public key only) for /.well-known/jwks.json.
 * Cached after first call.
 */
export async function getJWKS(): Promise<{ keys: JWK[] }> {
  if (!_jwks) {
    const privateKey = await getPrivateKey();
    const jwk = await exportJWK(privateKey);
    // Strip private components — only expose the public key
    const publicJwk: JWK = {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: "RS256",
      use: "sig",
      kid: "f3-auth-1",
    };
    _jwks = { keys: [publicJwk] };
  }
  return _jwks;
}

/**
 * Sign a JWT access token with RS256.
 */
export async function signAccessToken(params: {
  sub: number;
  email: string;
  scope: string;
  clientId: string;
  expiresInSeconds: number;
}): Promise<string> {
  const privateKey = await getPrivateKey();
  const issuer = env.NEXT_PUBLIC_AUTH_URL;

  return new SignJWT({
    token_use: "access",
    email: params.email,
    scope: params.scope,
    client_id: params.clientId,
  })
    .setProtectedHeader({ alg: "RS256", kid: "f3-auth-1" })
    .setSubject(params.sub.toString())
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(`${params.expiresInSeconds}s`)
    .sign(privateKey);
}

/**
 * Sign an OIDC ID Token with RS256. Only call this when "openid" is in the
 * granted scope — an ID Token asserts identity to the *client app itself*
 * (aud = client_id). No consumer reads it yet; this exists for future
 * RP-initiated logout (id_token_hint) and client-side identity checks.
 * Claim *selection* mirrors the userinfo endpoint's own scope gating
 * (name/picture under "profile", email/email_verified under "email"), but
 * the two surfaces aren't shape-identical: userinfo emits name/picture as
 * literal null when unavailable, this omits them entirely (see the comment
 * below on why), so don't assume a client can treat the two responses
 * interchangeably.
 */
export async function signIdToken(params: {
  sub: number;
  clientId: string;
  scope: string;
  expiresInSeconds: number;
  name?: string | null;
  picture?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  // OIDC replay-protection value, echoed back verbatim from the original
  // /authorize request. Omitted entirely when the client didn't send one
  // (nonce is optional per spec) — never emitted as an empty/null claim.
  nonce?: string | null;
  // When the end user actually authenticated, as an ISO timestamp string
  // (matches this repo's `timestamp(..., { mode: "string" })` convention
  // elsewhere) — converted to the NumericDate the auth_time claim expects.
  // Omitted when unknown (e.g. tokens issued before this was tracked).
  authTime?: string | null;
}): Promise<string> {
  const privateKey = await getPrivateKey();
  const issuer = env.NEXT_PUBLIC_AUTH_URL;
  const scopes = new Set(params.scope.split(" "));

  // Optional claims are omitted entirely when unavailable, not emitted as
  // explicit null — relying parties commonly validate these as "string or
  // absent," and a literal null on a claim they expect typed can break
  // strict OIDC parsing.
  //
  // token_use is always present, unlike the scope-gated claims below —
  // this token shares its signing key, kid, and issuer with access tokens
  // (see signAccessToken), so without an explicit discriminator every
  // verifier that checks signature + issuer alone would accept an ID
  // Token as a fully privileged API credential.
  const claims: Record<string, unknown> = { token_use: "id" };
  if (scopes.has("profile")) {
    if (params.name != null) claims.name = params.name;
    if (params.picture != null) claims.picture = params.picture;
  }
  if (scopes.has("email") && params.email != null) {
    claims.email = params.email;
    claims.email_verified = !!params.emailVerified;
  }
  if (params.nonce != null) claims.nonce = params.nonce;
  if (params.authTime != null) {
    const authTimeMs = new Date(params.authTime).getTime();
    if (!Number.isNaN(authTimeMs)) {
      claims.auth_time = Math.floor(authTimeMs / 1000);
    }
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "f3-auth-1" })
    .setSubject(params.sub.toString())
    .setIssuer(issuer)
    .setAudience(params.clientId)
    .setIssuedAt()
    .setExpirationTime(`${params.expiresInSeconds}s`)
    .sign(privateKey);
}
