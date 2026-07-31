import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from "jose";

import type * as JoseNs from "jose";

import type * as JwtModuleNs from "../../src/lib/jwt";

// Wrapped rather than stubbed: the module under test needs the real key import,
// and the counts are what pin its memoization. Hoisted so they survive the
// vi.resetModules() in loadJwtModule.
const jose = vi.hoisted(() => ({
  importPKCS8: vi.fn(),
  exportJWK: vi.fn(),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof JoseNs>();
  jose.importPKCS8.mockImplementation(actual.importPKCS8);
  jose.exportJWK.mockImplementation(actual.exportJWK);
  return {
    ...actual,
    importPKCS8: jose.importPKCS8,
    exportJWK: jose.exportJWK,
  };
});

const ISSUER = "https://auth.test.invalid";

type JwtModule = typeof JwtModuleNs;

let jwt: JwtModule;
let pkcs8: string;

// The env module snapshots process.env at import time, so the key has to be in
// place before the first import of ~/lib/jwt.
async function loadJwtModule(pem: string): Promise<JwtModule> {
  vi.resetModules();
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  vi.stubEnv("AUTH_JWT_PRIVATE_KEY", pem);
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", ISSUER);
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

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("signAccessToken", () => {
  it("signs a token that verifies against the published JWKS", async () => {
    // jose reads the clock separately for iat and exp, so a second boundary
    // between the two calls would make the 900s delta land on 901.
    let token: string;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      token = await signSample();
    } finally {
      vi.useRealTimers();
    }
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
      sub: Number.MAX_SAFE_INTEGER,
      email: "big-id@example.com",
      scope: "openid",
      clientId: "f3-map",
      expiresInSeconds: 60,
    });
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER });

    // packages/api/src/shared.ts does Number(payload.sub); this is the largest
    // id that survives that round-trip.
    expect(typeof payload.sub).toBe("string");
    expect(payload.sub).toBe("9007199254740991");
  });
});

describe("signIdToken", () => {
  async function signSampleId(overrides: Partial<Parameters<JwtModule["signIdToken"]>[0]> = {}) {
    return jwt.signIdToken({
      sub: 4242,
      clientId: "f3-map",
      scope: "openid profile email",
      expiresInSeconds: 900,
      name: "PermVac",
      picture: "https://example.com/avatar.jpg",
      email: "producer@example.com",
      emailVerified: true,
      ...overrides,
    });
  }

  it("signs a token that verifies against the published JWKS, audienced to the requesting client", async () => {
    const token = await signSampleId();
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, {
      issuer: ISSUER,
      audience: "f3-map",
      algorithms: ["RS256"],
    });

    expect(payload.sub).toBe("4242");
    expect(payload.aud).toBe("f3-map");
    expect(payload.name).toBe("PermVac");
    expect(payload.picture).toBe("https://example.com/avatar.jpg");
    expect(payload.email).toBe("producer@example.com");
    expect(payload.email_verified).toBe(true);
  });

  it("omits profile claims when profile scope wasn't granted", async () => {
    const token = await signSampleId({ scope: "openid email" });
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, {
      issuer: ISSUER,
      audience: "f3-map",
    });

    expect(payload.name).toBeUndefined();
    expect(payload.picture).toBeUndefined();
    expect(payload.email).toBe("producer@example.com");
  });

  it("omits email claims when email scope wasn't granted", async () => {
    const token = await signSampleId({ scope: "openid profile" });
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, {
      issuer: ISSUER,
      audience: "f3-map",
    });

    expect(payload.email).toBeUndefined();
    expect(payload.email_verified).toBeUndefined();
    expect(payload.name).toBe("PermVac");
  });

  it("emits only sub/iss/aud/exp/iat with a bare openid scope", async () => {
    const token = await signSampleId({ scope: "openid" });
    const keySet = createLocalJWKSet(await jwt.getJWKS());

    const { payload } = await jwtVerify(token, keySet, {
      issuer: ISSUER,
      audience: "f3-map",
    });

    expect(Object.keys(payload).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "iss",
      "sub",
    ]);
  });

  it("stamps the RS256 header and kid the API resolves keys by", async () => {
    const token = await signSampleId();

    expect(decodeProtectedHeader(token)).toEqual({
      alg: "RS256",
      kid: "f3-auth-1",
    });
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

describe("key memoization", () => {
  it("imports the private key and exports the JWK once per process", async () => {
    const fresh = await loadJwtModule(pkcs8);
    jose.importPKCS8.mockClear();
    jose.exportJWK.mockClear();

    await signSample(fresh);
    await signSample(fresh);
    await fresh.getJWKS();
    await fresh.getJWKS();

    // Without the memo, importPKCS8 would run an RSA key import per /token call.
    expect(jose.importPKCS8).toHaveBeenCalledTimes(1);
    expect(jose.exportJWK).toHaveBeenCalledTimes(1);
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
