import { exportJWK, importPKCS8, SignJWT } from "jose";
import type { JWK } from "jose";

import { env } from "~/env";

let _privateKey: CryptoKey | null = null;
let _jwks: { keys: JWK[] } | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  _privateKey ??= await importPKCS8(env.AUTH_JWT_PRIVATE_KEY, "RS256");
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
