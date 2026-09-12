import { randomUUID } from "node:crypto";
import type * as Jose from "jose";
import type * as ApiLogger from "../../logger";
import { createRouterClient } from "@orpc/server";
import { generateKeyPair, SignJWT } from "jose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "https://auth.example.test");
  return { key: vi.fn(), limit: vi.fn(), warn: vi.fn() };
});

vi.mock("../../logger", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiLogger>()),
  logWarn: mocks.warn,
}));

// Keep real JWT signature/issuer/expiry checks, replacing only JWKS retrieval.
vi.mock("jose", async (importOriginal) => ({
  ...(await importOriginal<typeof Jose>()),
  createRemoteJWKSet: () => mocks.key,
}));
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mocks.limit };
  }),
}));

import { getSessionFromHeaders } from "@acme/auth";
import { eq, inArray, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { protectedProcedure } from "../../shared";
import { meRouter } from "./index";

const clientFor = (token?: string) =>
  createRouterClient(
    {
      me: meRouter,
      identity: protectedProcedure.handler(({ context }) => ({
        id: context.session!.id,
        apiKeyId: context.session!.apiKey?.id,
        roles: context.session!.roles,
      })),
    },
    {
      context: () => ({
        reqHeaders: new Headers({
          client: "me-auth-test",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        }),
      }),
    },
  );

describe("Personal operations authentication", () => {
  const userIds: number[] = [];
  const keyIds: number[] = [];
  let ownerId: number;
  let userId: number;
  let orgId: number;
  let roleId: number;
  let positionId: number;
  let userToken: string;
  let expiredToken: string;
  let invalidSignatureToken: string;
  let idToken: string;
  const keys = {
    unprivileged: randomUUID(),
    admin: randomUUID(),
    expired: randomUUID(),
    revoked: randomUUID(),
    unknown: randomUUID(),
  };

  beforeAll(async () => {
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: "Auth Test Region", orgType: "region", isActive: true })
      .returning();
    orgId = org!.id;
    const [role] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, "admin"));
    roleId = role!.id;
    const [position] = await db
      .insert(schema.positions)
      .values({ name: "Auth Test Q", isActive: true })
      .returning();
    positionId = position!.id;
    for (const name of ["KeyOwner", "SignedInUser"]) {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `${randomUUID()}@example.test`,
          f3Name: name,
          firstName: name,
          emergencyNotes: "Synthetic private notes",
          homeRegionId: orgId,
        })
        .returning();
      userIds.push(user!.id);
    }
    [ownerId, userId] = userIds as [number, number];
    for (const name of [
      "unprivileged",
      "admin",
      "expired",
      "revoked",
    ] as const) {
      const [key] = await db
        .insert(schema.apiKeys)
        .values({
          name: `me-auth-${name}`,
          key: keys[name],
          ownerId,
          expiresAt: name === "expired" ? "2000-01-01 00:00:00" : null,
          revokedAt: name === "revoked" ? "2000-01-01 00:00:00" : null,
        })
        .returning();
      keyIds.push(key!.id);
      if (name === "admin")
        await db
          .insert(schema.rolesXApiKeysXOrg)
          .values({ apiKeyId: key!.id, roleId, orgId });
    }
    const pair = await generateKeyPair("RS256");
    mocks.key.mockResolvedValue(pair.publicKey);
    const sign = (
      tokenUse: string,
      expires: string,
      privateKey = pair.privateKey,
    ) =>
      new SignJWT({ token_use: tokenUse })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://auth.example.test")
        .setSubject(String(userId))
        .setIssuedAt()
        .setExpirationTime(expires)
        .sign(privateKey);
    userToken = await sign("access", "1h");
    expiredToken = await sign("access", "-1h");
    idToken = await sign("id", "1h");
    invalidSignatureToken = await sign(
      "access",
      "1h",
      (await generateKeyPair("RS256")).privateKey,
    );
  });

  beforeEach(async () => {
    mocks.warn.mockClear();
    vi.mocked(getSessionFromHeaders).mockResolvedValue(null);
    mocks.limit.mockResolvedValue({ success: true });
    for (const id of userIds) {
      await db
        .update(schema.users)
        .set({ f3Name: id === ownerId ? "KeyOwner" : "SignedInUser" })
        .where(eq(schema.users.id, id));
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ userId: id, orgId, roleId })
        .onConflictDoNothing();
      await db
        .insert(schema.positionsXOrgsXUsers)
        .values({ userId: id, orgId, positionId })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    await db
      .delete(schema.rolesXApiKeysXOrg)
      .where(inArray(schema.rolesXApiKeysXOrg.apiKeyId, keyIds));
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
    await db
      .delete(schema.rolesXUsersXOrg)
      .where(inArray(schema.rolesXUsersXOrg.userId, userIds));
    await db
      .delete(schema.positionsXOrgsXUsers)
      .where(inArray(schema.positionsXOrgsXUsers.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    if (positionId)
      await db
        .delete(schema.positions)
        .where(eq(schema.positions.id, positionId));
    if (orgId) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    vi.unstubAllEnvs();
  });

  const state = async (id: number) => ({
    profile: await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id)),
    roles: await db
      .select()
      .from(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, id)),
    positions: await db
      .select()
      .from(schema.positionsXOrgsXUsers)
      .where(eq(schema.positionsXOrgsXUsers.userId, id)),
  });
  const operations = {
    profile: (client: ReturnType<typeof clientFor>) => client.me.profile(),
    updateProfile: (client: ReturnType<typeof clientFor>) =>
      client.me.updateProfile({ f3Name: "Edited" }),
    deleteRole: (client: ReturnType<typeof clientFor>) =>
      client.me.deleteRole({ roleId, orgId }),
    deletePosition: (client: ReturnType<typeof clientFor>) =>
      client.me.deletePosition({ positionId, orgId }),
  };

  it.each(["unprivileged", "admin"] as const)(
    "resolves the %s key from the database but denies personal access",
    async (name) => {
      const client = clientFor(keys[name]);
      const identity = await client.identity();
      expect(identity.id).toBe(ownerId);
      expect(identity.apiKeyId).toBeTypeOf("number");
      expect(identity.roles).toHaveLength(name === "admin" ? 1 : 0);
      const before = await state(ownerId);
      for (const operation of Object.values(operations)) {
        mocks.warn.mockClear();
        await expect(operation(client)).rejects.toMatchObject({
          code: "UNAUTHORIZED",
          message: "Sign in with your user account to access this endpoint.",
        });
        expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
          "api.auth.personal_endpoint_api_key_denied",
          { apiKeyId: identity.apiKeyId },
        );
        expect(await state(ownerId)).toEqual(before);
      }
      // Lookup routes retain their existing policy.
      await expect(client.me.regions()).resolves.toHaveProperty("orgs");
      await expect(client.me.users({ userId })).resolves.toHaveProperty(
        "users",
      );
    },
  );

  it.each(["expired", "revoked", "unknown"] as const)(
    "preserves existing session-resolution rejection of a %s key",
    async (name) => {
      for (const operation of Object.values(operations)) {
        await expect(operation(clientFor(keys[name]))).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
    },
  );

  it("preserves existing session-resolution rejection of absent, expired, incorrectly signed and ID-token credentials", async () => {
    const before = await state(ownerId);
    for (const token of [
      undefined,
      expiredToken,
      invalidSignatureToken,
      idToken,
    ]) {
      for (const operation of Object.values(operations)) {
        await expect(operation(clientFor(token))).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
    }
    expect(await state(ownerId)).toEqual(before);
  });

  it.each(["session", "jwt", "session-and-key"] as const)(
    "allows %s to manage only the signed-in user's data",
    async (kind) => {
      if (kind !== "jwt") {
        // Mock only the cookie-session resolver, as in the existing API suite.
        vi.mocked(getSessionFromHeaders).mockResolvedValue({
          id: userId,
          email: "session-user@example.test",
          user: { id: String(userId), roles: [] },
          roles: [],
          expires: new Date(Date.now() + 3600000).toISOString(),
        });
      }
      const client = clientFor(
        kind === "jwt"
          ? userToken
          : kind === "session-and-key"
            ? keys.admin
            : undefined,
      );
      const ownerBefore = await state(ownerId);
      expect(await client.identity()).toMatchObject({
        id: userId,
        apiKeyId: undefined,
      });
      expect((await client.me.profile()).user.id).toBe(userId);
      await client.me.updateProfile({ f3Name: "Edited" });
      expect((await state(userId)).profile[0]?.f3Name).toBe("Edited");
      await client.me.deleteRole({ orgId, roleId });
      await client.me.deletePosition({ orgId, positionId });
      const after = await state(userId);
      expect(after.roles).toHaveLength(0);
      expect(after.positions).toHaveLength(0);
      expect(await state(ownerId)).toEqual(ownerBefore);
    },
  );

  it("preserves session precedence over a different user's valid Auth token", async () => {
    vi.mocked(getSessionFromHeaders).mockResolvedValue({
      id: ownerId,
      email: "session-owner@example.test",
      user: { id: String(ownerId), roles: [] },
      roles: [],
      expires: new Date(Date.now() + 3600000).toISOString(),
    });
    expect((await clientFor(userToken).me.profile()).user.id).toBe(ownerId);
  });
});
