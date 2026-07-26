import type { JWK } from "jose";
import { generateKeyPair, importJWK, SignJWT } from "jose";

import { FIXTURE_KID } from "../global-setup";

let cachedKey: CryptoKey | undefined;

async function signingKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    const jwk = process.env.CHAR_TEST_SIGNING_JWK;
    if (!jwk) throw new Error("global-setup did not publish a signing JWK");
    cachedKey = (await importJWK(JSON.parse(jwk) as JWK, "RS256")) as CryptoKey;
  }
  return cachedKey;
}

/** A second keypair, for bad-signature cases. */
export async function generateForeignKey(): Promise<CryptoKey> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  return privateKey;
}

/** Mirrors apps/auth/src/lib/jwt.ts signAccessToken's claim shape exactly. */
export async function signFixtureJwt(opts: {
  sub: number;
  expiresInSeconds?: number;
  issuer?: string;
  kid?: string;
  key?: CryptoKey;
}): Promise<string> {
  const key = opts.key ?? (await signingKey());
  const issuer = opts.issuer ?? process.env.NEXT_PUBLIC_AUTH_URL;
  if (!issuer) throw new Error("NEXT_PUBLIC_AUTH_URL is not set");

  return new SignJWT({
    email: "char-jwt@example.com",
    scope: "openid profile",
    client_id: "characterization",
  })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? FIXTURE_KID })
    .setSubject(opts.sub.toString())
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(`${opts.expiresInSeconds ?? 3600}s`)
    .sign(key);
}
