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
 * (aud = client_id), which is what RP-initiated logout's idTokenHint and
 * any client-side "who is this" check rely on. Claim selection mirrors the
 * userinfo endpoint's own scope gating (name/picture under "profile",
 * email/email_verified under "email") so both surfaces agree.
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
}): Promise<string> {
  const privateKey = await getPrivateKey();
  const issuer = env.NEXT_PUBLIC_AUTH_URL;
  const scopes = new Set(params.scope.split(" "));

  // Optional claims are omitted entirely when unavailable, not emitted as
  // explicit null — relying parties commonly validate these as "string or
  // absent," and a literal null on a claim they expect typed can break
  // strict OIDC parsing.
  const claims: Record<string, unknown> = {};
  if (scopes.has("profile")) {
    if (params.name != null) claims.name = params.name;
    if (params.picture != null) claims.picture = params.picture;
  }
  if (scopes.has("email") && params.email != null) {
    claims.email = params.email;
    claims.email_verified = !!params.emailVerified;
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
