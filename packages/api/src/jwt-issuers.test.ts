/**
 * JWT access tokens from more than one trusted issuer (AUTH_TRUSTED_ISSUERS),
 * verified end to end through shared.ts.
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
const FIRST_PARTY = "f3-me-test";
const jwksUrl = (issuer: string) => `${issuer}/.well-known/jwks.json`;

const mocks = vi.hoisted(() => ({
  keys: new Map<string, CryptoKey>(),
  created: [] as string[],
  fetched: [] as string[],
  failures: new Map<string, Error>(),
  limit: vi.fn(),
}));

// A rejected token falls through to the API-key lookup, which warns; mute it.
vi.mock("./logger", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiLogger>()),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("jose", async (importOriginal) => ({
  ...(await importOriginal<typeof Jose>()),
  createRemoteJWKSet: (url: URL) => {
    mocks.created.push(url.href);
    return () => {
      mocks.fetched.push(url.href);
      const failure = mocks.failures.get(url.href);
      if (failure) return Promise.reject(failure);
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

async function loadClient(env: {
  authUrl?: string;
  list?: string;
  clients?: string;
}) {
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", env.authUrl);
  vi.stubEnv("AUTH_TRUSTED_ISSUERS", env.list);
  vi.stubEnv(
    "AUTH_TRUSTED_CLIENT_IDS",
    "clients" in env ? env.clients : FIRST_PARTY,
  );
  vi.resetModules();
  const { protectedProcedure } = await import("./shared");
  const { auditContext } = await import("@acme/db");
  const router = {
    identity: protectedProcedure.handler(({ context }) => ({
      id: context.session!.id,
      auditActor: auditContext.getStore()?.userId,
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
  const sign = (
    issuer: string,
    privateKey: CryptoKey,
    tokenUse = "access",
    subject = userId,
    clientId: unknown = FIRST_PARTY,
  ) =>
    new SignJWT({ token_use: tokenUse, client_id: clientId })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setSubject(String(subject))
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
    mocks.failures.clear();
    mocks.limit.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  describe("with AUTH_TRUSTED_ISSUERS unset", () => {
    it.each([{}, { authUrl: PRIMARY }])(
      "accepts no JWT, whatever NEXT_PUBLIC_AUTH_URL is (%j)",
      async (env) => {
        const call = await loadClient(env);
        expect(mocks.created).toEqual([]);
        await expect(
          call(await sign(PRIMARY, primaryKey)),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect(mocks.fetched).toEqual([]);
      },
    );

    it("warns once at startup, and not when issuers are set", async () => {
      const { logWarn } = await import("./logger");
      const startupWarnings = async (env: { list?: string }) => {
        vi.mocked(logWarn).mockClear();
        await loadClient(env);
        return vi
          .mocked(logWarn)
          .mock.calls.filter(
            ([event]) => event === "api.auth.no_trusted_issuers",
          );
      };
      expect(await startupWarnings({})).toHaveLength(1);
      expect(await startupWarnings({ list: PRIMARY })).toHaveLength(0);
    });
  });

  describe("with one issuer in AUTH_TRUSTED_ISSUERS", () => {
    it("trusts only that issuer", async () => {
      const call = await loadClient({ list: PRIMARY });
      expect(mocks.created).toEqual([jwksUrl(PRIMARY)]);

      await expect(call(await sign(PRIMARY, primaryKey))).resolves.toEqual({
        id: userId,
        auditActor: userId,
      });

      mocks.fetched.length = 0;
      await expect(call(await sign(AUTH3, auth3Key))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(mocks.fetched).toEqual([]);
    });
  });

  describe("with both issuers in AUTH_TRUSTED_ISSUERS", () => {
    let call: (token: string) => Promise<{ id: number }>;

    beforeEach(async () => {
      call = await loadClient({
        authUrl: "https://ignored.example.test",
        list: ` ${PRIMARY} , ,${AUTH3},${AUTH3}/`,
      });
    });

    it("builds one key set per distinct listed issuer at import", () => {
      // Whitespace, an empty entry and a trailing-slash duplicate collapse
      // to the one origin, and NEXT_PUBLIC_AUTH_URL is not trusted.
      expect(mocks.created).toEqual([jwksUrl(PRIMARY), jwksUrl(AUTH3)]);
    });

    it("accepts the first issuer's token, checked against its keys", async () => {
      await expect(call(await sign(PRIMARY, primaryKey))).resolves.toEqual({
        id: userId,
        auditActor: userId,
      });
      expect(mocks.fetched).toEqual([jwksUrl(PRIMARY)]);
    });

    it("accepts the second issuer's token, checked against its keys", async () => {
      await expect(call(await sign(AUTH3, auth3Key))).resolves.toEqual({
        id: userId,
        auditActor: userId,
      });
      expect(mocks.fetched).toEqual([jwksUrl(AUTH3)]);
    });

    it("attributes verified bearer user 1 without legacy-cookie ambiguity", async () => {
      await expect(
        call(await sign(PRIMARY, primaryKey, "access", 1)),
      ).resolves.toEqual({
        id: 1,
        auditActor: 1,
      });
    });

    it("rejects an issuer that isn't allowlisted without fetching any keys", async () => {
      const { logWarn } = await import("./logger");
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
      expect(logWarn).toHaveBeenCalledWith("api.auth.issuer_not_trusted", {
        issuer: "https://evil.example.test",
      });
      expect(logWarn).toHaveBeenCalledWith("api.auth.issuer_not_trusted", {
        issuer: null,
      });

      // decodeJwt doesn't type-check claims; a non-string iss must still be
      // a plain rejection, not a thrown error (500), and is logged as null.
      vi.mocked(logWarn).mockClear();
      for (const iss of [123, { url: AUTH3 }]) {
        const oddIssuer = await new SignJWT({
          token_use: "access",
          iss: iss as unknown as string,
        })
          .setProtectedHeader({ alg: "RS256" })
          .setSubject(String(userId))
          .setExpirationTime("1h")
          .sign(auth3Key);
        await expect(call(oddIssuer)).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
      // Each token also warns from the API-key fallback, so count only the
      // issuer warnings: one per odd token.
      const issuerWarnings = vi
        .mocked(logWarn)
        .mock.calls.filter(
          ([event]) => event === "api.auth.issuer_not_trusted",
        );
      expect(issuerWarnings).toEqual([
        ["api.auth.issuer_not_trusted", { issuer: null }],
        ["api.auth.issuer_not_trusted", { issuer: null }],
      ]);
      expect(mocks.fetched).toEqual([]);
    });

    it("reports one issuer's key outage and keeps accepting the other issuer", async () => {
      const { logError } = await import("./logger");
      const down = new TypeError("fetch failed", {
        cause: { code: "ECONNREFUSED" },
      });
      mocks.failures.set(jwksUrl(AUTH3), down);
      await expect(call(await sign(AUTH3, auth3Key))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(logError).toHaveBeenCalledWith(
        "api.auth.jwks_unavailable",
        { issuer: AUTH3, reason: "ECONNREFUSED" },
        down,
      );
      await expect(call(await sign(PRIMARY, primaryKey))).resolves.toEqual({
        id: userId,
        auditActor: userId,
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

    it("still rejects a listed issuer's ID token", async () => {
      await expect(
        call(await sign(AUTH3, auth3Key, "id")),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejects a trusted issuer's token that has no exp", async () => {
      const noExp = await new SignJWT({ token_use: "access" })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(AUTH3)
        .setSubject(String(userId))
        .setIssuedAt()
        .sign(auth3Key);
      await expect(call(noExp)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("OAuth client allowlist (AUTH_TRUSTED_CLIENT_IDS)", () => {
    it("accepts each listed client and rejects any other client's token", async () => {
      const { logWarn } = await import("./logger");
      const call = await loadClient({
        list: PRIMARY,
        clients: `${FIRST_PARTY}, f3-admin-test`,
      });
      for (const clientId of [FIRST_PARTY, "f3-admin-test"]) {
        await expect(
          call(await sign(PRIMARY, primaryKey, "access", userId, clientId)),
        ).resolves.toEqual({ id: userId, auditActor: userId });
      }

      vi.mocked(logWarn).mockClear();
      for (const clientId of ["third-party-app", `${FIRST_PARTY}-x`, ""]) {
        await expect(
          call(await sign(PRIMARY, primaryKey, "access", userId, clientId)),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      }
      expect(logWarn).toHaveBeenCalledWith("api.auth.client_not_trusted", {
        clientId: "third-party-app",
      });
    });

    it("rejects a token with no client_id or a non-string one", async () => {
      const { logWarn } = await import("./logger");
      const call = await loadClient({ list: PRIMARY });
      vi.mocked(logWarn).mockClear();
      const noClientId = await new SignJWT({ token_use: "access" })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(PRIMARY)
        .setSubject(String(userId))
        .setExpirationTime("1h")
        .sign(primaryKey);
      const tokens = [
        noClientId,
        await sign(PRIMARY, primaryKey, "access", userId, 123),
        await sign(PRIMARY, primaryKey, "access", userId, [FIRST_PARTY]),
      ];
      for (const token of tokens) {
        await expect(call(token)).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
      const clientWarnings = vi
        .mocked(logWarn)
        .mock.calls.filter(
          ([event]) => event === "api.auth.client_not_trusted",
        );
      expect(clientWarnings).toEqual([
        ["api.auth.client_not_trusted", { clientId: null }],
        ["api.auth.client_not_trusted", { clientId: null }],
        ["api.auth.client_not_trusted", { clientId: null }],
      ]);
    });

    it("accepts no JWT when unset, and warns at startup", async () => {
      const { logWarn } = await import("./logger");
      vi.mocked(logWarn).mockClear();
      const call = await loadClient({ list: PRIMARY, clients: undefined });
      expect(logWarn).toHaveBeenCalledWith(
        "api.auth.no_trusted_client_ids",
        expect.anything(),
      );
      await expect(call(await sign(PRIMARY, primaryKey))).rejects.toMatchObject(
        { code: "UNAUTHORIZED" },
      );
    });

    it("does not warn about client ids when no issuer is trusted", async () => {
      const { logWarn } = await import("./logger");
      vi.mocked(logWarn).mockClear();
      await loadClient({ clients: undefined });
      expect(logWarn).not.toHaveBeenCalledWith(
        "api.auth.no_trusted_client_ids",
        expect.anything(),
      );
    });
  });

  it("fails at import when a listed issuer is malformed", async () => {
    await expect(
      loadClient({ list: `${AUTH3},auth3.example` }),
    ).rejects.toThrow(/Invalid AUTH_TRUSTED_ISSUERS entry "auth3.example"/);
  });
});
