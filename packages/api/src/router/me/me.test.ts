/**
 * Tests for Me Router endpoints
 *
 * These are integration tests that require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 *
 * Run with: pnpm test --filter @acme/api
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

import { auth } from "@acme/auth";
import type { Session } from "@acme/auth";
import { and, eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { router } from "../../index";

/** Cast auth to its session-retrieval overload so vi.mocked types correctly. */
const mockAuth = vi.mocked(auth as () => Promise<Session | null>);

/** Build a minimal Session object for test mocking. */
const makeTestSession = (
  id: number,
  email: string,
  name = "TestPax",
): Session =>
  ({
    id,
    email,
    user: { id: String(id), email, name, roles: [] },
    roles: [],
    expires: new Date(Date.now() + 86400000).toISOString(),
  }) as unknown as Session;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test client that simulates a direct API caller.
 * Auth is provided via the mocked auth() function.
 */
const createDirectClient = () => {
  const headers: Record<string, string> = {
    [Header.Client]: Client.ORPC,
  };
  return createRouterClient(router, {
    context: () =>
      Promise.resolve({
        reqHeaders: new Headers(headers),
      }),
  });
};

const uniqueEmail = () =>
  `me-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

// ---------------------------------------------------------------------------
// Test-scoped state — cleaned up in afterAll
// ---------------------------------------------------------------------------
const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];
let testUserId: number;
let testUserEmail: string;
let regionOrgId: number;
let regionOrgName: string;
let positionId: number;
let roleId: number;

describe("Me Router", () => {
  beforeAll(async () => {
    // --- ensure a region org exists ---
    const [existingRegion] = await db
      .select({ id: schema.orgs.id, name: schema.orgs.name })
      .from(schema.orgs)
      .where(eq(schema.orgs.orgType, "region"))
      .limit(1);

    if (existingRegion) {
      regionOrgId = existingRegion.id;
      regionOrgName = existingRegion.name;
    } else {
      const [created] = await db
        .insert(schema.orgs)
        .values({ name: "Test Region", orgType: "region", isActive: true })
        .returning({ id: schema.orgs.id, name: schema.orgs.name });
      regionOrgId = created!.id;
      regionOrgName = created!.name;
      createdOrgIds.push(regionOrgId);
    }

    // --- create a test user ---
    testUserEmail = uniqueEmail();
    const [user] = await db
      .insert(schema.users)
      .values({
        email: testUserEmail,
        f3Name: "TestPax",
        firstName: "Test",
        lastName: "Pax",
        homeRegionId: regionOrgId,
      })
      .returning({ id: schema.users.id });
    testUserId = user!.id;
    createdUserIds.push(testUserId);

    // --- ensure we have a position & role to assign ---
    const [existingPos] = await db
      .select({ id: schema.positions.id })
      .from(schema.positions)
      .where(eq(schema.positions.isActive, true))
      .limit(1);

    if (existingPos) {
      positionId = existingPos.id;
    } else {
      const [created] = await db
        .insert(schema.positions)
        .values({ name: "Site Q", isActive: true })
        .returning({ id: schema.positions.id });
      positionId = created!.id;
    }

    const [existingRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .limit(1);
    roleId = existingRole!.id;

    // --- give the test user a position and a role ---
    await db.insert(schema.positionsXOrgsXUsers).values({
      positionId,
      orgId: regionOrgId,
      userId: testUserId,
    });
    await db.insert(schema.rolesXUsersXOrg).values({
      roleId,
      orgId: regionOrgId,
      userId: testUserId,
    });
  });

  afterAll(async () => {
    // Clean up in FK-safe order
    for (const uid of createdUserIds) {
      await db
        .delete(schema.positionsXOrgsXUsers)
        .where(eq(schema.positionsXOrgsXUsers.userId, uid));
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    for (const oid of createdOrgIds) {
      await db.delete(schema.orgs).where(eq(schema.orgs.id, oid));
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 200,
      remaining: 199,
      reset: Date.now() + 60000,
    });
    // Restore auth mock to the test user after clearAllMocks
    mockAuth.mockResolvedValue(makeTestSession(testUserId, testUserEmail));
  });

  // -----------------------------------------------------------------------
  // profile (GET)
  // -----------------------------------------------------------------------
  describe("profile", () => {
    it("should return the user's full profile with roles and positions", async () => {
      const client = createDirectClient();
      const result = await client.me.profile();

      expect(result.user).toBeDefined();
      expect(result.user.id).toBe(testUserId);
      expect(result.user.f3Name).toBe("TestPax");
      expect(result.user.email).toBe(testUserEmail);
      expect(Array.isArray(result.user.roles)).toBe(true);
      expect(Array.isArray(result.user.positions)).toBe(true);
      expect(result.user.roles.length).toBeGreaterThanOrEqual(1);
      expect(result.user.positions.length).toBeGreaterThanOrEqual(1);
    });

    it("should throw NOT_FOUND for a non-existent user ID", async () => {
      mockAuth.mockResolvedValueOnce(
        makeTestSession(999999, "ghost@example.com", "Ghost"),
      );
      const client = createDirectClient();
      await expect(client.me.profile()).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // updateProfile (PATCH)
  // -----------------------------------------------------------------------
  describe("updateProfile", () => {
    it("should update basic string fields", async () => {
      const client = createDirectClient();
      const result = await client.me.updateProfile({
        f3Name: "UpdatedPax",
        firstName: "Updated",
        lastName: "Name",
      });

      expect(result.user.f3Name).toBe("UpdatedPax");
      expect(result.user.firstName).toBe("Updated");
      expect(result.user.lastName).toBe("Name");

      // Restore original values
      await client.me.updateProfile({
        f3Name: "TestPax",
        firstName: "Test",
        lastName: "Pax",
      });
    });

    it("should update phone", async () => {
      const client = createDirectClient();
      const result = await client.me.updateProfile({ phone: "555-1234" });
      expect(result.user.phone).toBe("555-1234");

      // Clean up
      await client.me.updateProfile({ phone: null });
    });

    it("should update homeRegionId", async () => {
      const client = createDirectClient();
      const result = await client.me.updateProfile({
        homeRegionId: regionOrgId,
      });
      expect(result.user.homeRegionId).toBe(regionOrgId);
    });

    it("should set homeRegionId to null", async () => {
      const client = createDirectClient();
      await client.me.updateProfile({ homeRegionId: null });
      const profile = await client.me.profile();
      expect(profile.user.homeRegionId).toBeNull();

      // Restore
      await client.me.updateProfile({ homeRegionId: regionOrgId });
    });

    it("should update emergency contact fields", async () => {
      const client = createDirectClient();
      const result = await client.me.updateProfile({
        emergencyContact: "Jane Doe",
        emergencyPhone: "555-9876",
        emergencyNotes: "No allergies",
      });

      expect(result.user.emergencyContact).toBe("Jane Doe");
      expect(result.user.emergencyPhone).toBe("555-9876");
      expect(result.user.emergencyNotes).toBe("No allergies");

      // Clean up
      await client.me.updateProfile({
        emergencyContact: null,
        emergencyPhone: null,
        emergencyNotes: null,
      });
    });

    it("should merge meta fields with existing meta", async () => {
      const client = createDirectClient();

      // Set initial meta
      await client.me.updateProfile({ meta: { f3_name_origin: "First post" } });
      // Merge additional meta
      const result = await client.me.updateProfile({
        meta: { my_f3_why: "Brotherhood" },
      });

      const meta = result.user.meta as Record<string, unknown>;
      expect(meta.f3_name_origin).toBe("First post");
      expect(meta.my_f3_why).toBe("Brotherhood");
    });

    it("should update avatarUrl with a valid URL", async () => {
      const client = createDirectClient();
      const url = "https://storage.example.com/avatar.jpg";
      const result = await client.me.updateProfile({ avatarUrl: url });
      expect(result.user.avatarUrl).toBe(url);

      // Clean up
      await client.me.updateProfile({ avatarUrl: null });
    });

    it("should reject an invalid avatarUrl", async () => {
      const client = createDirectClient();
      await expect(
        client.me.updateProfile({ avatarUrl: "not-a-url" }),
      ).rejects.toThrow();
    });

    it("should reject unknown fields (strict schema)", async () => {
      const client = createDirectClient();
      await expect(
        client.me.updateProfile({
          // @ts-expect-error — testing runtime validation
          status: "inactive",
        }),
      ).rejects.toThrow();
    });

    it("should return the full profile after a no-op update", async () => {
      const client = createDirectClient();
      // Empty object — nothing to update, but should still return profile
      const result = await client.me.updateProfile({});
      expect(result.user.id).toBe(testUserId);
      expect(Array.isArray(result.user.roles)).toBe(true);
      expect(Array.isArray(result.user.positions)).toBe(true);
    });

    it("should throw NOT_FOUND when updating a non-existent user", async () => {
      mockAuth.mockResolvedValueOnce(
        makeTestSession(999999, "ghost@example.com", "Ghost"),
      );
      const client = createDirectClient();
      await expect(
        client.me.updateProfile({ f3Name: "Ghost" }),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // regions (GET)
  // -----------------------------------------------------------------------
  describe("regions", () => {
    it("should return a list of region orgs", async () => {
      const client = createDirectClient();
      const result = await client.me.regions();

      expect(result).toHaveProperty("orgs");
      expect(Array.isArray(result.orgs)).toBe(true);
      expect(result.orgs.length).toBeGreaterThanOrEqual(1);

      const region = result.orgs.find((o) => o.id === regionOrgId);
      expect(region).toBeDefined();
      expect(region!.name).toBe(regionOrgName);
    });

    it("should include isActive flag on each region", async () => {
      const client = createDirectClient();
      const result = await client.me.regions();

      for (const org of result.orgs) {
        expect(typeof org.isActive).toBe("boolean");
      }
    });

    it("should return regions in alphabetical order", async () => {
      const client = createDirectClient();
      const result = await client.me.regions();

      const names = result.orgs.map((o) => o.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });
  });

  // -----------------------------------------------------------------------
  // deletePosition (DELETE)
  // -----------------------------------------------------------------------
  describe("deletePosition", () => {
    it("should remove a position assignment and return found:true", async () => {
      const client = createDirectClient();

      // First add a position to delete
      await db
        .insert(schema.positionsXOrgsXUsers)
        .values({
          positionId,
          orgId: regionOrgId,
          userId: testUserId,
        })
        .onConflictDoNothing();

      const result = await client.me.deletePosition({
        positionId,
        orgId: regionOrgId,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      // Verify it's gone
      const [remaining] = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.userId, testUserId),
            eq(schema.positionsXOrgsXUsers.positionId, positionId),
            eq(schema.positionsXOrgsXUsers.orgId, regionOrgId),
          ),
        );
      expect(remaining).toBeUndefined();
    });

    it("should return found:false when assignment does not exist", async () => {
      const client = createDirectClient();
      const result = await client.me.deletePosition({
        positionId: 999999,
        orgId: regionOrgId,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
    });

    it("should reject invalid positionId", async () => {
      const client = createDirectClient();
      await expect(
        client.me.deletePosition({ positionId: 0, orgId: regionOrgId }),
      ).rejects.toThrow();
    });

    it("should reject invalid orgId", async () => {
      const client = createDirectClient();
      await expect(
        client.me.deletePosition({ positionId, orgId: -1 }),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // deleteRole (DELETE)
  // -----------------------------------------------------------------------
  describe("deleteRole", () => {
    it("should remove a role assignment and return found:true", async () => {
      const client = createDirectClient();

      // Ensure the role assignment exists
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({
          roleId,
          orgId: regionOrgId,
          userId: testUserId,
        })
        .onConflictDoNothing();

      const result = await client.me.deleteRole({
        roleId,
        orgId: regionOrgId,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      // Verify it's gone
      const [remaining] = await db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(
          and(
            eq(schema.rolesXUsersXOrg.userId, testUserId),
            eq(schema.rolesXUsersXOrg.roleId, roleId),
            eq(schema.rolesXUsersXOrg.orgId, regionOrgId),
          ),
        );
      expect(remaining).toBeUndefined();
    });

    it("should return found:false when role assignment does not exist", async () => {
      const client = createDirectClient();
      const result = await client.me.deleteRole({
        roleId: 999999,
        orgId: regionOrgId,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
    });

    it("should reject invalid roleId", async () => {
      const client = createDirectClient();
      await expect(
        client.me.deleteRole({ roleId: 0, orgId: regionOrgId }),
      ).rejects.toThrow();
    });

    it("should reject invalid orgId", async () => {
      const client = createDirectClient();
      await expect(
        client.me.deleteRole({ roleId, orgId: -1 }),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // users (GET)
  // -----------------------------------------------------------------------
  describe("users", () => {
    it("should return all users when no filter is provided", async () => {
      const client = createDirectClient();
      const result = await client.me.users();

      expect(result).toHaveProperty("users");
      expect(Array.isArray(result.users)).toBe(true);
      expect(result.users.length).toBeGreaterThanOrEqual(1);

      // Verify shape
      const first = result.users[0]!;
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("f3Name");
      expect(first).toHaveProperty("homeRegionId");
      expect(first).toHaveProperty("status");
    });

    it("should filter by homeRegionId", async () => {
      const client = createDirectClient();
      const result = await client.me.users({ homeRegionId: regionOrgId });

      expect(result.users.length).toBeGreaterThanOrEqual(1);
      for (const u of result.users) {
        expect(u.homeRegionId).toBe(regionOrgId);
      }
    });

    it("should return empty array for a region with no users", async () => {
      const client = createDirectClient();
      const result = await client.me.users({ homeRegionId: 999999 });
      expect(result.users).toEqual([]);
    });

    it("should include homeRegionName via left join", async () => {
      const client = createDirectClient();
      const result = await client.me.users({ homeRegionId: regionOrgId });

      const testUser = result.users.find((u) => u.id === testUserId);
      expect(testUser).toBeDefined();
      expect(testUser!.homeRegionName).toBe(regionOrgName);
    });

    it("should return results in a consistent order", async () => {
      const client = createDirectClient();
      const result1 = await client.me.users();
      const result2 = await client.me.users();

      // Same query should yield the same order
      const ids1 = result1.users.map((u) => u.id);
      const ids2 = result2.users.map((u) => u.id);
      expect(ids1).toEqual(ids2);
    });

    it("should reject a non-integer homeRegionId", async () => {
      const client = createDirectClient();
      await expect(client.me.users({ homeRegionId: 1.5 })).rejects.toThrow();
    });
  });
});
