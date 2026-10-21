/**
 * JWT access tokens from more than one trusted issuer (NEXT_PUBLIC_AUTH_URL
 * plus AUTH_ADDITIONAL_ISSUERS), verified end to end through shared.ts.
 *
 * shared.ts builds its issuer list and JWKS fetchers at import time, so each
 * case stubs the env and re-imports it. Real signature/issuer/expiry checks
 * run; only the JWKS fetch is replaced, by a per-URL fake that records which
 * issuers' key sets were asked for.
 */
import { randomUUID } from "node:crypto";
import type * as Jose from "jose";
import type * as ApiLogger from "./logger";
import { createRouterClient } from "@orpc/server";
import { generateKeyPair, SignJWT } from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";

const PRIMARY = "https://auth2.example.test";
const AUTH3 = "https://auth3.example.test";
const jwksUrl = (issuer: string) => `${issuer}/.well-known/jwks.json`;

const mocks = vi.hoisted(() => ({
  keys: new Map<string, CryptoKey>(),
  created: [] as string[],
  fetched: [] as string[],
  limit: vi.fn(),
}));

// A rejected token falls through to the API-key lookup, which warns; mute it.
vi.mock("./logger", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiLogger>()),
  logWarn: vi.fn(),
}));
vi.mock("jose", async (importOriginal) => ({
  ...(await importOriginal<typeof Jose>()),
  createRemoteJWKSet: (url: URL) => {
    mocks.created.push(url.href);
    return () => {
      mocks.fetched.push(url.href);
      const key = mocks.keys.get(url.href);
      return key
        ? Promise.resolve(key)
        : Promise.reject(new Error(`no key set for ${url.href}`));
    };
  },
}));
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mocks.limit };
  }),
}));
// No cookie session, so only the bearer token can authenticate.
vi.mock("@acme/auth", () => ({
  getSessionFromHeaders: vi.fn(() => Promise.resolve(null)),
}));

async function loadClient(env: { primary?: string; additional?: string }) {
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", env.primary);
  vi.stubEnv("AUTH_ADDITIONAL_ISSUERS", env.additional);
  vi.resetModules();
  const { protectedProcedure } = await import("./shared");
  const router = {
    identity: protectedProcedure.handler(({ context }) => ({
      id: context.session!.id,
    })),
  };
  return (token: string) =>
    createRouterClient(router, {
      context: () => ({
        reqHeaders: new Headers({
          client: "jwt-issuers-test",
          authorization: `Bearer ${token}`,
        }),
      }),
    }).identity();
}

describe("JWT verification across trusted issuers", () => {
  let userId: number;
  let primaryKey: CryptoKey;
  let auth3Key: CryptoKey;
  const sign = (issuer: string, privateKey: CryptoKey, tokenUse = "access") =>
    new SignJWT({ token_use: tokenUse })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setSubject(String(userId))
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

  beforeAll(async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `${randomUUID()}@example.test`, f3Name: "Issuer" })
      .returning();
    userId = user!.id;
    const primary = await generateKeyPair("RS256");
    const auth3 = await generateKeyPair("RS256");
    primaryKey = primary.privateKey;
    auth3Key = auth3.privateKey;
    mocks.keys.set(jwksUrl(PRIMARY), primary.publicKey);
    mocks.keys.set(jwksUrl(AUTH3), auth3.publicKey);
  });

  beforeEach(() => {
    mocks.created.length = 0;
    mocks.fetched.length = 0;
    mocks.limit.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  describe("with AUTH_ADDITIONAL_ISSUERS unset", () => {
    it("trusts only the primary issuer, as before", async () => {
      const call = await loadClient({ primary: PRIMARY });
      expect(mocks.created).toEqual([jwksUrl(PRIMARY)]);

      await expect(call(await sign(PRIMARY, primaryKey))).resolves.toEqual({
        id: userId,
      });

      mocks.fetched.length = 0;
      await expect(call(await sign(AUTH3, auth3Key))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(mocks.fetched).toEqual([]);
    });

    it("accepts no JWT when no issuer is configured at all", async () => {
      const call = await loadClient({});
      expect(mocks.created).toEqual([]);
      await expect(call(await sign(PRIMARY, primaryKey))).rejects.toMatchObject(
        { code: "UNAUTHORIZED" },
      );
      expect(mocks.fetched).toEqual([]);
    });
  });

  describe("with an additional issuer", () => {
    let call: (token: string) => Promise<{ id: number }>;

    beforeEach(async () => {
      call = await loadClient({
        primary: PRIMARY,
        additional: ` ${AUTH3} , ,${AUTH3}/`,
      });
    });

    it("builds one key set per distinct issuer at import", () => {
      // Whitespace, an empty entry and a trailing-slash duplicate collapse
      // to the one origin.
      expect(mocks.created).toEqual([jwksUrl(PRIMARY), jwksUrl(AUTH3)]);
    });

    it("still accepts a primary-issuer token, checked against the primary's keys", async () => {
      await expect(call(await sign(PRIMARY, primaryKey))).resolves.toEqual({
        id: userId,
      });
      expect(mocks.fetched).toEqual([jwksUrl(PRIMARY)]);
    });

    it("accepts an additional-issuer token, checked against that issuer's keys", async () => {
      await expect(call(await sign(AUTH3, auth3Key))).resolves.toEqual({
        id: userId,
      });
      expect(mocks.fetched).toEqual([jwksUrl(AUTH3)]);
    });

    it("rejects an issuer that isn't allowlisted without fetching any keys", async () => {
      for (const issuer of [
        "https://evil.example.test",
        `${AUTH3}/`,
        "https://auth3.example.test.evil.example",
      ]) {
        await expect(call(await sign(issuer, auth3Key))).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
      const noIssuer = await new SignJWT({ token_use: "access" })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject(String(userId))
        .setExpirationTime("1h")
        .sign(auth3Key);
      await expect(call(noIssuer)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(mocks.fetched).toEqual([]);
      const { logWarn } = await import("./logger");
      expect(logWarn).toHaveBeenCalledWith("api.auth.issuer_not_trusted", {
        issuer: "https://evil.example.test",
      });
      expect(logWarn).toHaveBeenCalledWith("api.auth.issuer_not_trusted", {
        issuer: null,
      });
    });

    it("rejects a token signed by one issuer's key but claiming another issuer", async () => {
      await expect(call(await sign(AUTH3, primaryKey))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(call(await sign(PRIMARY, auth3Key))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      // Each was checked only against the key set of the issuer it claimed.
      expect(mocks.fetched).toEqual([jwksUrl(AUTH3), jwksUrl(PRIMARY)]);
    });

    it("still rejects an additional issuer's ID token", async () => {
      await expect(
        call(await sign(AUTH3, auth3Key, "id")),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  it("fails at import when an additional issuer is malformed", async () => {
    await expect(
      loadClient({ primary: PRIMARY, additional: `${AUTH3},auth3.example` }),
    ).rejects.toThrow(/Invalid AUTH_ADDITIONAL_ISSUERS entry "auth3.example"/);
  });
});
