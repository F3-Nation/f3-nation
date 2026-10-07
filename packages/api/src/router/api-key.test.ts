/**
 * Tests for API Key Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../logger", { spy: true });

import type { Session } from "@acme/auth";
import { eq, inArray, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createMixedOrgTree,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import * as loggerModule from "../logger";

describe("API Key Router", () => {
  // Track created API keys for cleanup
  const createdApiKeyIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset rate limiter to allow requests
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    // Clean up all created API keys
    for (const apiKeyId of createdApiKeyIds.reverse()) {
      try {
        await cleanup.apiKey(apiKeyId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe("list", () => {
    it("should return a list of API keys", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.apiKey.list();

      expect(result).toHaveProperty("apiKeys");
      expect(Array.isArray(result.apiKeys)).toBe(true);
    });

    it("should include key signature (last 4 chars)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create an API key first
      const client = createTestClient();
      const createResult = await client.apiKey.create({
        name: `List Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      const result = await client.apiKey.list();

      // Check that keys have signature
      if (result.apiKeys.length > 0) {
        const key = result.apiKeys.find((k) => k.id === createResult.id);
        expect(key).toBeDefined();
        expect(key?.keySignature).toBeDefined();
        expect(key?.keySignature?.length).toBe(4);
      }
    });

    // Regression: read-only keys (e.g. the seeded Map App key) carry no role
    // association — read-only access is the absence of a role. Listing such a
    // key must succeed and report empty roles, not fail output validation.
    it("should list a read-only key (no roles) without failing validation", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const createResult = await client.apiKey.create({
        name: `Read-only List Test ${uniqueId()}`,
      });
      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      const result = await client.apiKey.list();
      const key = result.apiKeys.find((k) => k.id === createResult.id);
      expect(key).toBeDefined();
      expect(key?.roles).toEqual([]);
      expect(key?.orgIds).toEqual([]);
    });
  });

  describe("create", () => {
    it("should create an API key with name only", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key ${uniqueId()}`;

      const result = await client.apiKey.create({
        name: keyName,
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("secret");
      expect(result.name).toBe(keyName);
      expect(result.secret).toMatch(/^f3_/); // API keys start with f3_

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should create an API key with description", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key ${uniqueId()}`;
      const description = "Test description for API key";

      const result = await client.apiKey.create({
        name: keyName,
        description,
      });

      expect(result.name).toBe(keyName);
      expect(result.description).toBe(description);

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should create an API key with roles", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key with Roles ${uniqueId()}`;

      const result = await client.apiKey.create({
        name: keyName,
        roles: [
          {
            orgId: nationOrg.id,
            roleName: "editor",
          },
        ],
      });

      expect(result).toHaveProperty("id");
      expect(result.name).toBe(keyName);

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }

      // Verify the role was created
      const listResult = await client.apiKey.list();
      const createdKey = listResult.apiKeys.find((k) => k.id === result.id);
      expect(createdKey?.roles?.length).toBeGreaterThan(0);
    });

    it("should create an API key with expiration date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Expiring API Key ${uniqueId()}`;
      const expiresAt = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 30,
      ).toISOString(); // 30 days from now

      const result = await client.apiKey.create({
        name: keyName,
        expiresAt,
      });

      expect(result.name).toBe(keyName);
      expect(result.expiresAt).toBeDefined();

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should require a name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.create({
          name: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("revoke", () => {
    it("should revoke an API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Revoke Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Revoke it
      const result = await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.revokedAt).toBeDefined();
    });

    it("should restore a revoked API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create and revoke an API key
      const createResult = await client.apiKey.create({
        name: `Restore Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      // Restore it
      const result = await client.apiKey.revoke({
        id: createResult.id,
        revoke: false,
      });

      expect(result.apiKey?.revokedAt).toBeNull();
    });

    it("should throw for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.revoke({
          id: 999999,
          revoke: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("purge", () => {
    it("should permanently delete an API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Purge Test ${uniqueId()}`,
      });

      const keyId = createResult.id;

      // Purge it
      const result = await client.apiKey.purge({
        id: keyId,
      });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.id).toBe(keyId);

      // Verify it's gone
      const [deletedKey] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, keyId));

      expect(deletedKey).toBeUndefined();

      // Don't add to cleanup since it's already deleted
    });

    it("should throw for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.purge({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return true for valid API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Validate Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(true);
    });

    it("should return false for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      const result = await client.apiKey.validate({
        key: "f3_nonexistent_key_12345",
      });

      expect(result.isValid).toBe(false);
    });

    it("should return false for revoked key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create and revoke an API key
      const createResult = await client.apiKey.create({
        name: `Validate Revoked Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(false);
    });

    it("should return false for expired key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key that's already expired
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
      const createResult = await client.apiKey.create({
        name: `Validate Expired Test ${uniqueId()}`,
        expiresAt: expiredDate,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(false);
    });
  });

  describe("access scoping", () => {
    const createdOrgIds: number[] = [];
    const createdUserIds: number[] = [];
    const scopedKeyIds: number[] = [];
    let tree: Awaited<ReturnType<typeof createMixedOrgTree>>;
    let regionAdminId: number;
    let regionAdminEmail: string;
    let otherUserId: number;
    let inactiveOrgId: number;

    const insertUser = async () => {
      const [user] = await db
        .insert(schema.users)
        .values({ email: `${uniqueId()}@example.com`, f3Name: "Key Owner" })
        .returning({ id: schema.users.id, email: schema.users.email });
      if (!user) throw new Error("Failed to create user");
      createdUserIds.push(user.id);
      return user;
    };

    const insertKey = async (
      ownerId: number,
      roles: { orgId: number; roleName: "editor" | "admin" }[] = [],
    ) => {
      const secret = `f3_${uniqueId()}`;
      const [apiKey] = await db
        .insert(schema.apiKeys)
        .values({ key: secret, name: `Scoped ${uniqueId()}`, ownerId })
        .returning({ id: schema.apiKeys.id });
      if (!apiKey) throw new Error("Failed to create API key");
      scopedKeyIds.push(apiKey.id);
      if (roles.length > 0) {
        const roleRows = await db
          .select({ id: schema.roles.id, name: schema.roles.name })
          .from(schema.roles)
          .where(
            inArray(
              schema.roles.name,
              roles.map((r) => r.roleName),
            ),
          );
        await db.insert(schema.rolesXApiKeysXOrg).values(
          roles.map((r) => ({
            apiKeyId: apiKey.id,
            orgId: r.orgId,
            roleId: roleRows.find((row) => row.name === r.roleName)!.id,
          })),
        );
      }
      return { id: apiKey.id, secret };
    };

    const regionAdminSession = (
      viaApiKey = false,
      extraRoles: Session["roles"] = [],
    ): Session => {
      const roles = [
        {
          orgId: tree.directBranch.region.id,
          orgName: tree.directBranch.region.name ?? "Region",
          roleName: "admin" as const,
        },
        ...extraRoles,
      ];
      return {
        id: regionAdminId,
        email: "region-admin@example.com",
        user: {
          id: String(regionAdminId),
          email: "region-admin@example.com",
          name: "Region Admin",
          roles,
        },
        roles,
        ...(viaApiKey && {
          apiKey: {
            id: 0,
            key: "f3_x...xxxx",
            ownerId: regionAdminId,
            revokedAt: null,
            expiresAt: null,
            orgIds: [tree.directBranch.region.id],
          },
        }),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    };

    const nationAdminSession = (): Session => {
      const roles = [
        { orgId: 1, orgName: "F3 Nation", roleName: "admin" as const },
      ];
      return {
        id: otherUserId,
        email: "nation-admin@example.com",
        user: {
          id: String(otherUserId),
          email: "nation-admin@example.com",
          name: "Nation Admin",
          roles,
        },
        roles,
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    };

    beforeAll(async () => {
      await getOrCreateRoles();
      tree = await createMixedOrgTree(createdOrgIds);
      ({ id: regionAdminId, email: regionAdminEmail } = await insertUser());
      ({ id: otherUserId } = await insertUser());
      const [inactiveOrg] = await db
        .insert(schema.orgs)
        .values({
          name: `Inactive ${uniqueId()}`,
          orgType: "ao",
          parentId: tree.unrelatedBranch.region.id,
          isActive: false,
        })
        .returning({ id: schema.orgs.id });
      inactiveOrgId = inactiveOrg!.id;
      createdOrgIds.push(inactiveOrgId);
    });

    afterAll(async () => {
      for (const id of scopedKeyIds) await cleanup.apiKey(id);
      for (const id of createdUserIds) await cleanup.user(id);
      for (const id of [...createdOrgIds].reverse()) await cleanup.org(id);
    });

    it("lists only keys the region admin can manage", async () => {
      const inScope = await insertKey(otherUserId, [
        { orgId: tree.directBranch.ao.id, roleName: "admin" },
      ]);
      const ownReadOnly = await insertKey(regionAdminId);
      const otherRegion = await insertKey(otherUserId, [
        { orgId: tree.unrelatedBranch.region.id, roleName: "admin" },
      ]);
      const nationKey = await insertKey(otherUserId, [
        { orgId: tree.nation.id, roleName: "admin" },
      ]);
      const mixed = await insertKey(otherUserId, [
        { orgId: tree.directBranch.ao.id, roleName: "admin" },
        { orgId: tree.unrelatedBranch.ao.id, roleName: "editor" },
      ]);
      const inactiveMixed = await insertKey(otherUserId, [
        { orgId: tree.directBranch.ao.id, roleName: "admin" },
        { orgId: inactiveOrgId, roleName: "admin" },
      ]);
      const othersReadOnly = await insertKey(otherUserId);

      await mockAuthWithSession(regionAdminSession());
      const { apiKeys } = await createTestClient().apiKey.list();
      const ids = apiKeys.map((k) => k.id);

      expect(apiKeys.find((k) => k.id === inScope.id)?.ownerEmail).toBeNull();
      expect(ids).toContain(inScope.id);
      expect(ids).toContain(ownReadOnly.id);
      for (const hidden of [
        otherRegion,
        nationKey,
        mixed,
        inactiveMixed,
        othersReadOnly,
      ]) {
        expect(ids).not.toContain(hidden.id);
      }
    });

    it("rejects every API-key management endpoint for an API-key session", async () => {
      const owned = await insertKey(regionAdminId);

      await mockAuthWithSession(regionAdminSession(true));
      const client = createTestClient();
      const unauthorized = { code: "UNAUTHORIZED" };

      await expect(client.apiKey.list()).rejects.toMatchObject(unauthorized);
      await expect(
        client.apiKey.create({ name: "child", roles: [], expiresAt: null }),
      ).rejects.toMatchObject(unauthorized);
      await expect(
        client.apiKey.revoke({ id: owned.id, revoke: true }),
      ).rejects.toMatchObject(unauthorized);
      await expect(client.apiKey.purge({ id: owned.id })).rejects.toMatchObject(
        unauthorized,
      );
      await expect(
        client.apiKey.validate({ key: "anything" }),
      ).rejects.toMatchObject(unauthorized);

      const [row] = await db
        .select({ revokedAt: schema.apiKeys.revokedAt })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, owned.id));
      expect(row?.revokedAt).toBeNull();
    });

    it("lets an owner see and revoke, but not restore or purge, a key wider than them", async () => {
      const ownedNationKey = await insertKey(regionAdminId, [
        { orgId: tree.nation.id, roleName: "admin" },
      ]);
      const ownedInScope = await insertKey(regionAdminId, [
        { orgId: tree.directBranch.ao.id, roleName: "admin" },
      ]);

      await mockAuthWithSession(regionAdminSession());
      const client = createTestClient();
      const { apiKeys } = await client.apiKey.list();

      expect(apiKeys.find((k) => k.id === ownedNationKey.id)).toMatchObject({
        canManage: false,
      });
      expect(apiKeys.find((k) => k.id === ownedInScope.id)).toMatchObject({
        canManage: true,
      });

      await client.apiKey.revoke({ id: ownedNationKey.id, revoke: true });
      await expect(
        client.apiKey.revoke({ id: ownedNationKey.id, revoke: false }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        client.apiKey.purge({ id: ownedNationKey.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const [row] = await db
        .select({ revokedAt: schema.apiKeys.revokedAt })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, ownedNationKey.id));
      expect(row?.revokedAt).not.toBeNull();
    });

    it("rejects revoke, restore, and purge of an out-of-scope key", async () => {
      const outOfScope = [
        await insertKey(otherUserId, [
          { orgId: tree.nation.id, roleName: "admin" },
        ]),
        await insertKey(otherUserId, [
          { orgId: tree.directBranch.ao.id, roleName: "admin" },
          { orgId: tree.unrelatedBranch.ao.id, roleName: "editor" },
        ]),
        await insertKey(otherUserId, [
          { orgId: tree.directBranch.ao.id, roleName: "admin" },
          { orgId: inactiveOrgId, roleName: "editor" },
        ]),
        await insertKey(otherUserId, [
          { orgId: inactiveOrgId, roleName: "editor" },
        ]),
      ];

      await mockAuthWithSession(regionAdminSession());
      const client = createTestClient();
      const ids = (await client.apiKey.list()).apiKeys.map((k) => k.id);

      for (const key of outOfScope) {
        expect(ids).not.toContain(key.id);
        for (const revoke of [false, true]) {
          await expect(
            client.apiKey.revoke({ id: key.id, revoke }),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        }
        await expect(client.apiKey.purge({ id: key.id })).rejects.toMatchObject(
          { code: "NOT_FOUND" },
        );

        const [row] = await db
          .select({ revokedAt: schema.apiKeys.revokedAt })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, key.id));
        expect(row).toEqual({ revokedAt: null });
      }
    });

    it("does not count an editor role toward key-management scope", async () => {
      const editorScoped = await insertKey(otherUserId, [
        { orgId: tree.unrelatedBranch.ao.id, roleName: "editor" },
      ]);

      await mockAuthWithSession(
        regionAdminSession(false, [
          {
            orgId: tree.unrelatedBranch.region.id,
            orgName: tree.unrelatedBranch.region.name ?? "Region",
            roleName: "editor",
          },
        ]),
      );
      const client = createTestClient();
      const ids = (await client.apiKey.list()).apiKeys.map((k) => k.id);

      expect(ids).not.toContain(editorScoped.id);
      for (const revoke of [false, true]) {
        await expect(
          client.apiKey.revoke({ id: editorScoped.id, revoke }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      await expect(
        client.apiKey.purge({ id: editorScoped.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("logs denied management of an existing key but not of a missing one", async () => {
      const nationKey = await insertKey(otherUserId, [
        { orgId: tree.nation.id, roleName: "admin" },
      ]);

      await mockAuthWithSession(regionAdminSession());
      const client = createTestClient();

      await expect(
        client.apiKey.revoke({ id: 999999, revoke: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(loggerModule.logWarn).not.toHaveBeenCalledWith(
        "api.api_key.manage_denied",
        expect.anything(),
      );

      await expect(
        client.apiKey.purge({ id: nationKey.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(loggerModule.logWarn).toHaveBeenCalledWith(
        "api.api_key.manage_denied",
        {
          apiKeyId: nationKey.id,
          userId: regionAdminId,
          viaApiKeyId: undefined,
        },
      );
    });

    it("only creates keys the caller can also manage", async () => {
      await mockAuthWithSession(
        regionAdminSession(false, [
          {
            orgId: tree.unrelatedBranch.ao.id,
            orgName: tree.unrelatedBranch.ao.name ?? "AO",
            roleName: "editor",
          },
        ]),
      );
      const client = createTestClient();

      await expect(
        client.apiKey.create({
          name: `Scoped ${uniqueId()}`,
          roles: [{ orgId: tree.unrelatedBranch.ao.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const created = await client.apiKey.create({
        name: `Scoped ${uniqueId()}`,
        roles: [{ orgId: tree.directBranch.ao.id, roleName: "editor" }],
      });
      scopedKeyIds.push(created.id);
      const ids = (await client.apiKey.list()).apiKeys.map((k) => k.id);
      expect(ids).toContain(created.id);
    });

    it("manages an in-scope key without ever returning its secret", async () => {
      const inScope = await insertKey(otherUserId, [
        { orgId: tree.directBranch.ao.id, roleName: "editor" },
      ]);

      await mockAuthWithSession(regionAdminSession());
      const client = createTestClient();

      const listed = await client.apiKey.list();
      const revoked = await client.apiKey.revoke({
        id: inScope.id,
        revoke: true,
      });
      const restored = await client.apiKey.revoke({
        id: inScope.id,
        revoke: false,
      });
      const purged = await client.apiKey.purge({ id: inScope.id });

      expect(revoked.apiKey?.revokedAt).not.toBeNull();
      expect(restored.apiKey?.revokedAt).toBeNull();
      expect(purged.apiKey?.id).toBe(inScope.id);
      expect(
        await db
          .select()
          .from(schema.rolesXApiKeysXOrg)
          .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, inScope.id)),
      ).toEqual([]);
      for (const response of [listed, revoked, restored, purged]) {
        expect(JSON.stringify(response)).not.toContain(inScope.secret);
      }
      expect(revoked.apiKey).not.toHaveProperty("key");
    });

    it("lets a Nation admin manage any key", async () => {
      const othersReadOnly = await insertKey(regionAdminId);

      await mockAuthWithSession(nationAdminSession());
      const client = createTestClient();
      const { apiKeys } = await client.apiKey.list();

      expect(apiKeys.find((k) => k.id === othersReadOnly.id)?.ownerEmail).toBe(
        regionAdminEmail,
      );
      await expect(
        client.apiKey.revoke({ id: othersReadOnly.id, revoke: true }),
      ).resolves.toBeDefined();
    });
  });
});
