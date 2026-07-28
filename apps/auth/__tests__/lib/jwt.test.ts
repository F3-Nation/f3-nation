import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from "jose";

import type * as JwtModuleNs from "../../src/lib/jwt";

const ISSUER = "https://auth.test.invalid";

type JwtModule = typeof JwtModuleNs;

let jwt: JwtModule;
let pkcs8: string;

// The env module snapshots process.env at import time, so the key has to be in
// place before the first import of ~/lib/jwt.
async function loadJwtModule(pem: string): Promise<JwtModule> {
  vi.resetModules();
  process.env.SKIP_ENV_VALIDATION = "true";
  process.env.AUTH_JWT_PRIVATE_KEY = pem;
  process.env.NEXT_PUBLIC_AUTH_URL = ISSUER;
  return import("../../src/lib/jwt");
}

async function signSample(mod: JwtModule = jwt) {
  return mod.signAccessToken({
    sub: 4242,
    email: "producer@example.com",
    scope: "openid profile",
    clientId: "f3-map",
    expiresInSeconds: 900,
  });
}

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  pkcs8 = await exportPKCS8(privateKey);
  jwt = await loadJwtModule(pkcs8);
});

describe("signAccessToken", () => {
  it("signs a token that verifies against the published JWKS", async () => {
    const token = await signSample();
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, {
      issuer: ISSUER,
      algorithms: ["RS256"],
    });

    expect(payload.email).toBe("producer@example.com");
    expect(payload.scope).toBe("openid profile");
    expect(payload.client_id).toBe("f3-map");
    expect(payload.exp! - payload.iat!).toBe(900);
  });

  it("stamps the RS256 header and kid the API resolves keys by", async () => {
    const token = await signSample();

    expect(decodeProtectedHeader(token)).toEqual({
      alg: "RS256",
      kid: "f3-auth-1",
    });
  });

  it("emits exactly the claim set the apps/api characterization fixture mirrors", async () => {
    const token = await signSample();
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER });

    expect(Object.keys(payload).sort()).toEqual([
      "client_id",
      "email",
      "exp",
      "iat",
      "iss",
      "scope",
      "sub",
    ]);
  });

  it("serializes sub as a numeric string, not a number", async () => {
    const token = await jwt.signAccessToken({
      sub: 90071992547,
      email: "big-id@example.com",
      scope: "openid",
      clientId: "f3-map",
      expiresInSeconds: 60,
    });
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER });

    expect(typeof payload.sub).toBe("string");
    expect(payload.sub).toBe("90071992547");
  });
});

describe("getJWKS", () => {
  it("publishes public key material only", async () => {
    const jwks = await jwt.getJWKS();

    expect(jwks.keys).toHaveLength(1);
    // Exact key set guards against a private RSA component (d/p/q/dp/dq/qi) leaking into the public JWKS.
    expect(Object.keys(jwks.keys[0]!).sort()).toEqual([
      "alg",
      "e",
      "kid",
      "kty",
      "n",
      "use",
    ]);
    expect(jwks.keys[0]).toMatchObject({
      kty: "RSA",
      alg: "RS256",
      use: "sig",
      kid: "f3-auth-1",
    });
  });

  it("caches the document across calls", async () => {
    expect(await jwt.getJWKS()).toBe(await jwt.getJWKS());
  });
});

describe("private key loading", () => {
  it("accepts the single-line escaped-newline PEM used in .env", async () => {
    const escaped = pkcs8.trimEnd().replace(/\n/g, "\\n");

    const fresh = await loadJwtModule(escaped);
    const token = await signSample(fresh);
    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet(await fresh.getJWKS()),
      { issuer: ISSUER },
    );

    expect(payload.sub).toBe("4242");
  });
});
