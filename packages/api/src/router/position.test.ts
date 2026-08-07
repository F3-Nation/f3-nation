/**
 * Tests for Position Router endpoints
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

import { and, eq, inArray, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createNoPermissionSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("Position Router", () => {
  // Track created entities for cleanup
  const createdPositionIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];

  beforeAll(async () => {
    await getOrCreateRoles();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    // Batch-delete assignments by position and org
    if (createdPositionIds.length > 0) {
      try {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(
            inArray(schema.positionsXOrgsXUsers.positionId, createdPositionIds),
          );
      } catch {
        // Ignore
      }
    }
    if (createdOrgIds.length > 0) {
      try {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(inArray(schema.positionsXOrgsXUsers.orgId, createdOrgIds));
      } catch {
        // Ignore
      }
    }
    // Clean up positions
    if (createdPositionIds.length > 0) {
      try {
        await db
          .delete(schema.positions)
          .where(inArray(schema.positions.id, createdPositionIds));
      } catch {
        // Ignore
      }
    }
    // Clean up role assignments then users
    for (const userId of createdUserIds.reverse()) {
      try {
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, userId));
      } catch {
        // Ignore
      }
      try {
        await cleanup.user(userId);
      } catch {
        // Ignore
      }
    }
    // Clean up orgs
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore
      }
    }
  }, 30000);

  // --- Helpers ---

  const createTestRegion = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Failed to create test region");
    createdOrgIds.push(region.id);
    return region;
  };

  const createTestUser = async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `testuser-${uniqueId()}@example.com`,
        f3Name: `TestPax ${uniqueId()}`,
      })
      .returning();
    if (!user) throw new Error("Failed to create test user");
    createdUserIds.push(user.id);
    return user;
  };

  const createTestPosition = async (opts?: {
    orgId?: number | null;
    orgType?: "ao" | "region" | null;
    name?: string;
  }) => {
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: opts?.name ?? `Test Position ${uniqueId()}`,
        orgId: opts?.orgId === undefined ? undefined : opts.orgId,
        orgType: opts?.orgType === undefined ? undefined : opts.orgType,
        isActive: true,
      })
      .returning();
    if (!position) throw new Error("Failed to create test position");
    createdPositionIds.push(position.id);
    return position;
  };

  const createTestAssignment = async (
    positionId: number,
    orgId: number,
    userId: number,
  ) => {
    await db.insert(schema.positionsXOrgsXUsers).values({
      positionId,
      orgId,
      userId,
    });
  };

  /**
   * Creates a real admin user+role in the DB so that
   * getEditableOrgIdsForUser can resolve nation admin status from the DB.
   */
  const createDbBackedAdminSession = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const user = await createTestUser();

    const [adminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "admin"));
    if (!adminRole) throw new Error("Admin role not found in DB");

    await db.insert(schema.rolesXUsersXOrg).values({
      roleId: adminRole.id,
      userId: user.id,
      orgId: nationOrg.id,
    });

    const session = {
      id: user.id,
      email: user.email,
      user: {
        id: String(user.id),
        email: user.email,
        name: user.f3Name,
        roles: [
          {
            orgId: nationOrg.id,
            orgName: nationOrg.name ?? "F3 Nation",
            roleName: "admin" as const,
          },
        ],
      },
      roles: [
        {
          orgId: nationOrg.id,
          orgName: nationOrg.name ?? "F3 Nation",
          roleName: "admin" as const,
        },
      ],
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    };

    return { session, user };
  };

  // --- Tests ---

  describe("all", () => {
    it("should return positions with totalCount", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.position.all();

      expect(result).toHaveProperty("positions");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.positions)).toBe(true);
      expect(typeof result.totalCount).toBe("number");
    });

    it("should paginate results", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const allResult = await client.position.all();

      const pageResult = await client.position.all({
        pageIndex: 0,
        pageSize: 2,
      });

      expect(pageResult.positions.length).toBeLessThanOrEqual(2);
      expect(pageResult.totalCount).toBe(allResult.totalCount);
    });

    it("should filter by searchTerm", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const suffix = uniqueId();
      const pos = await createTestPosition({
        name: `SearchablePos ${suffix}`,
      });

      const client = createTestClient();
      const result = await client.position.all({
        searchTerm: `SearchablePos ${suffix}`,
      });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(pos.id);
      expect(result.totalCount).toBeGreaterThanOrEqual(1);
    });

    it("should filter by orgId and include global positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const globalPos = await createTestPosition({
        orgId: null,
        name: `Global ${uniqueId()}`,
      });
      const regionPos = await createTestPosition({
        orgId: region.id,
        name: `Region ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.all({ orgId: region.id });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(globalPos.id);
      expect(ids).toContain(regionPos.id);
    });

    it("should exclude global positions when ignoreGlobalPositions is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const globalPos = await createTestPosition({
        orgId: null,
        name: `Global ${uniqueId()}`,
      });
      const regionPos = await createTestPosition({
        orgId: region.id,
        name: `Region ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.all({
        orgId: region.id,
        ignoreGlobalPositions: true,
      });

      const ids = result.positions.map((p) => p.id);
      expect(ids).not.toContain(globalPos.id);
      expect(ids).toContain(regionPos.id);
    });

    it("should filter by orgType", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const aoPos = await createTestPosition({
        orgType: "ao",
        name: `AO Pos ${uniqueId()}`,
      });
      const regionPos = await createTestPosition({
        orgType: "region",
        name: `Reg Pos ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.all({ orgType: "ao" });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(aoPos.id);
      expect(ids).not.toContain(regionPos.id);
    });

    it("should filter by isActive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const activePos = await createTestPosition({
        orgId: region.id,
        name: `Active ${uniqueId()}`,
      });

      // Create an inactive position directly
      const [inactivePos] = await db
        .insert(schema.positions)
        .values({
          name: `Inactive ${uniqueId()}`,
          orgId: region.id,
          isActive: false,
        })
        .returning();
      if (!inactivePos) throw new Error("Failed to create inactive position");
      createdPositionIds.push(inactivePos.id);

      const client = createTestClient();

      // Default (active only)
      const activeResult = await client.position.all({ orgId: region.id });
      const activeIds = activeResult.positions.map((p) => p.id);
      expect(activeIds).toContain(activePos.id);
      expect(activeIds).not.toContain(inactivePos.id);

      // Explicitly get inactive
      const inactiveResult = await client.position.all({
        orgId: region.id,
        isActive: false,
      });
      const inactiveIds = inactiveResult.positions.map((p) => p.id);
      expect(inactiveIds).toContain(inactivePos.id);
      expect(inactiveIds).not.toContain(activePos.id);
    });

    it("should order global positions first, then alphabetically", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const suffix = uniqueId();
      const globalPos = await createTestPosition({
        orgId: null,
        name: `ZZZ Global ${suffix}`,
      });
      const regionPos = await createTestPosition({
        orgId: region.id,
        name: `AAA Region ${suffix}`,
      });

      const client = createTestClient();
      const result = await client.position.all({ orgId: region.id });

      const ids = result.positions.map((p) => p.id);
      const globalIdx = ids.indexOf(globalPos.id);
      const regionIdx = ids.indexOf(regionPos.id);
      expect(globalIdx).toBeLessThan(regionIdx);
    });
  });

  describe("byOrgId", () => {
    it("should return only positions for the specified org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const region2 = await createTestRegion();
      const pos1 = await createTestPosition({
        orgId: region.id,
        name: `Pos1 ${uniqueId()}`,
      });
      const pos2 = await createTestPosition({
        orgId: region2.id,
        name: `Pos2 ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.byOrgId({ orgId: region.id });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(pos1.id);
      expect(ids).not.toContain(pos2.id);
    });

    it("should not include global positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const globalPos = await createTestPosition({
        orgId: null,
        name: `Global ${uniqueId()}`,
      });
      const regionPos = await createTestPosition({
        orgId: region.id,
        name: `Region ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.byOrgId({ orgId: region.id });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(regionPos.id);
      expect(ids).not.toContain(globalPos.id);
    });
  });

  describe("byId", () => {
    it("should return a position by its ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const pos = await createTestPosition({ name: `ById ${uniqueId()}` });

      const client = createTestClient();
      const result = await client.position.byId({ id: pos.id });

      expect(result.position?.id).toBe(pos.id);
      expect(result.position?.name).toBe(pos.name);
      expect(result.position?.isActive).toBe(true);
    });

    it("should throw NOT_FOUND for non-existent position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      await expect(client.position.byId({ id: 999999 })).rejects.toThrow();
    });
  });

  describe("crupdate", () => {
    it("should create a new org-specific position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const posName = `New Position ${uniqueId()}`;
      const client = createTestClient();
      const result = await client.position.crupdate({
        name: posName,
        orgId: region.id,
        orgType: "region",
      });

      expect(result.position).not.toBeNull();
      expect(result.position!.name).toBe(posName);
      expect(result.position!.orgId).toBe(region.id);
      createdPositionIds.push(result.position!.id);
    });

    it("should update an existing position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const pos = await createTestPosition({ orgId: region.id });

      const updatedName = `Updated ${uniqueId()}`;
      const client = createTestClient();
      const result = await client.position.crupdate({
        id: pos.id,
        name: updatedName,
        orgId: region.id,
      });

      expect(result.position!.id).toBe(pos.id);
      expect(result.position!.name).toBe(updatedName);
    });

    it("should reject unauthorized users", async () => {
      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const region = await createTestRegion();

      const client = createTestClient();
      await expect(
        client.position.crupdate({
          name: `Unauth ${uniqueId()}`,
          orgId: region.id,
        }),
      ).rejects.toThrow();
    });

    it("should reject a non-Nation editor rescoping a global position", async () => {
      const region = await createTestRegion();
      const globalPos = await createTestPosition({ orgId: null });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      await expect(
        client.position.crupdate({
          id: globalPos.id,
          name: globalPos.name,
          orgId: region.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("delete", () => {
    it("should soft-delete an org-specific position", async () => {
      const region = await createTestRegion();
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const pos = await createTestPosition({ orgId: region.id });

      const client = createTestClient();
      const result = await client.position.delete({ id: pos.id });

      expect(result.positionId).toBe(pos.id);

      // Verify it's soft-deleted
      const [dbPos] = await db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.id, pos.id));
      expect(dbPos?.isActive).toBe(false);
    });

    it("should also delete assignments for the position", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const pos = await createTestPosition({ orgId: region.id });
      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      await client.position.delete({ id: pos.id });

      // Verify assignment is removed
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(eq(schema.positionsXOrgsXUsers.positionId, pos.id));
      expect(assignments).toHaveLength(0);
    });

    it("should throw NOT_FOUND for non-existent position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      await expect(client.position.delete({ id: 999999 })).rejects.toThrow();
    });

    it("should reject deleting global positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const globalPos = await createTestPosition({ orgId: null });

      const client = createTestClient();
      await expect(
        client.position.delete({ id: globalPos.id }),
      ).rejects.toThrow();
    });

    it("should reject unauthorized users", async () => {
      const region = await createTestRegion();
      const pos = await createTestPosition({ orgId: region.id });

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(client.position.delete({ id: pos.id })).rejects.toThrow();
    });
  });

  describe("getAssignments", () => {
    it("should return positions with assigned users for an org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });
      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignments({
        orgId: region.id,
      });

      expect(result.positions).toBeDefined();
      const found = result.positions.find((p) => p.id === pos.id);
      expect(found).toBeDefined();
      expect(found!.users.map((u) => u.id)).toContain(user.id);
    });

    it("should return empty users for positions with no assignments", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const pos = await createTestPosition({ orgId: region.id });

      const client = createTestClient();
      const result = await client.position.getAssignments({
        orgId: region.id,
        regionOrgId: region.id,
      });

      const found = result.positions.find((p) => p.id === pos.id);
      expect(found).toBeDefined();
      expect(found!.users).toEqual([]);
    });

    it("should include global positions matching the org type", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const globalPos = await createTestPosition({
        orgId: null,
        orgType: "region",
        name: `Global Region Pos ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.getAssignments({
        orgId: region.id,
      });

      const ids = result.positions.map((p) => p.id);
      expect(ids).toContain(globalPos.id);
    });
  });

  describe("updateAssignments", () => {
    it("should replace assignments for specified positions", async () => {
      const region = await createTestRegion();
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      // Assign user1 first
      await createTestAssignment(pos.id, region.id, user1.id);

      const client = createTestClient();
      // Replace with user2 only
      const result = await client.position.updateAssignments({
        orgId: region.id,
        assignments: [{ positionId: pos.id, userIds: [user2.id] }],
      });

      expect(result.success).toBe(true);
      expect(result.assignmentCount).toBe(1);

      // Verify user1 was removed and user2 was added
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, pos.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
          ),
        );
      const userIds = assignments.map((a) => a.userId);
      expect(userIds).toContain(user2.id);
      expect(userIds).not.toContain(user1.id);
    });

    it("should handle empty userIds (remove all assignments)", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.updateAssignments({
        orgId: region.id,
        assignments: [{ positionId: pos.id, userIds: [] }],
      });

      expect(result.success).toBe(true);
      expect(result.assignmentCount).toBe(0);

      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, pos.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
          ),
        );
      expect(assignments).toHaveLength(0);
    });

    it("should reject unauthorized users", async () => {
      const region = await createTestRegion();
      const pos = await createTestPosition({ orgId: region.id });

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.position.updateAssignments({
          orgId: region.id,
          assignments: [{ positionId: pos.id, userIds: [] }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("deleteAssignment", () => {
    it("should delete an existing assignment", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.deleteAssignment({
        positionId: pos.id,
        orgId: region.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(true);

      // Verify deleted from DB
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, pos.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
            eq(schema.positionsXOrgsXUsers.userId, user.id),
          ),
        );
      expect(assignments).toHaveLength(0);
    });

    it("should return found=false for non-existent assignment", async () => {
      const region = await createTestRegion();

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const result = await client.position.deleteAssignment({
        positionId: 999999,
        orgId: region.id,
        userId: 999999,
      });

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
    });

    it("should reject unauthorized users", async () => {
      const region = await createTestRegion();

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.position.deleteAssignment({
          positionId: 1,
          orgId: region.id,
          userId: 1,
        }),
      ).rejects.toThrow();
    });
  });

  describe("addAssignment", () => {
    it("should add a new assignment", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const result = await client.position.addAssignment({
        positionId: pos.id,
        orgId: region.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);

      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, pos.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
            eq(schema.positionsXOrgsXUsers.userId, user.id),
          ),
        );
      expect(assignments).toHaveLength(1);
    });

    it("should be idempotent — succeed if assignment already exists", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.addAssignment({
        positionId: pos.id,
        orgId: region.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);

      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, pos.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
            eq(schema.positionsXOrgsXUsers.userId, user.id),
          ),
        );
      expect(assignments).toHaveLength(1);
    });

    it("should reject unauthorized users", async () => {
      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.position.addAssignment({
          positionId: pos.id,
          orgId: region.id,
          userId: user.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getAllAssignments", () => {
    it("should return assignments with joined display data", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({
        orgId: region.id,
        name: `GetAll Pos ${uniqueId()}`,
      });
      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({});

      expect(result.assignments).toBeDefined();
      const found = result.assignments.find(
        (a) =>
          a.positionId === pos.id &&
          a.orgId === region.id &&
          a.userId === user.id,
      );
      expect(found).toBeDefined();
      expect(found!.positionName).toBe(pos.name);
      expect(found!.orgName).toBe(region.name);
      expect(found!.f3Name).toBe(user.f3Name);
    });

    it("should filter by orgId", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region1 = await createTestRegion();
      const region2 = await createTestRegion();
      const user = await createTestUser();
      const pos1 = await createTestPosition({ orgId: region1.id });
      const pos2 = await createTestPosition({ orgId: region2.id });

      await createTestAssignment(pos1.id, region1.id, user.id);
      await createTestAssignment(pos2.id, region2.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({
        orgId: region1.id,
      });

      const orgIds = result.assignments.map((a) => a.orgId);
      expect(orgIds).toContain(region1.id);
      expect(orgIds).not.toContain(region2.id);
    });

    it("should filter by positionId", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const pos1 = await createTestPosition({ orgId: region.id });
      const pos2 = await createTestPosition({ orgId: region.id });

      await createTestAssignment(pos1.id, region.id, user.id);
      await createTestAssignment(pos2.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({
        positionId: pos1.id,
      });

      const positionIds = result.assignments.map((a) => a.positionId);
      expect(positionIds).toContain(pos1.id);
      expect(positionIds).not.toContain(pos2.id);
    });

    it("should filter by userId", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const pos = await createTestPosition({ orgId: region.id });

      await createTestAssignment(pos.id, region.id, user1.id);
      await createTestAssignment(pos.id, region.id, user2.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({
        userId: user1.id,
      });

      const userIds = result.assignments.map((a) => a.userId);
      expect(userIds).toContain(user1.id);
      expect(userIds).not.toContain(user2.id);
    });

    it("should exclude inactive positions by default", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const activePos = await createTestPosition({ orgId: region.id });
      const inactivePos = await createTestPosition({ orgId: region.id });

      await db
        .update(schema.positions)
        .set({ isActive: false })
        .where(eq(schema.positions.id, inactivePos.id));

      await createTestAssignment(activePos.id, region.id, user.id);
      await createTestAssignment(inactivePos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({
        userId: user.id,
      });

      const positionIds = result.assignments.map((a) => a.positionId);
      expect(positionIds).toContain(activePos.id);
      expect(positionIds).not.toContain(inactivePos.id);
    });

    it("should include inactive when includeInactive is true", async () => {
      const { session } = await createDbBackedAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const activePos = await createTestPosition({ orgId: region.id });
      const inactivePos = await createTestPosition({ orgId: region.id });

      await db
        .update(schema.positions)
        .set({ isActive: false })
        .where(eq(schema.positions.id, inactivePos.id));

      await createTestAssignment(activePos.id, region.id, user.id);
      await createTestAssignment(inactivePos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({
        userId: user.id,
        includeInactive: true,
      });

      const positionIds = result.assignments.map((a) => a.positionId);
      expect(positionIds).toContain(activePos.id);
      expect(positionIds).toContain(inactivePos.id);
    });

    it("should return empty array for users with no editable orgs", async () => {
      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      const result = await client.position.getAllAssignments({});

      expect(result.assignments).toEqual([]);
    });
  });

  describe("getAssignmentsByUserId", () => {
    it("should return assignments for a user with position and org names", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const pos = await createTestPosition({
        orgId: region.id,
        name: `Named Pos ${uniqueId()}`,
      });
      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]).toMatchObject({
        positionId: pos.id,
        orgId: region.id,
        positionName: pos.name,
        orgName: region.name,
      });
    });

    it("should return empty array for user with no assignments", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const user = await createTestUser();

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
      });

      expect(result.assignments).toEqual([]);
    });

    it("should return multiple assignments across orgs", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region1 = await createTestRegion();
      const region2 = await createTestRegion();
      const user = await createTestUser();
      const pos1 = await createTestPosition({ orgId: region1.id });
      const pos2 = await createTestPosition({ orgId: region2.id });

      await createTestAssignment(pos1.id, region1.id, user.id);
      await createTestAssignment(pos2.id, region2.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
      });

      expect(result.assignments).toHaveLength(2);
      const orgIds = result.assignments.map((a) => a.orgId);
      expect(orgIds).toContain(region1.id);
      expect(orgIds).toContain(region2.id);
    });

    it("should exclude inactive positions by default", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const activePos = await createTestPosition({ orgId: region.id });
      const inactivePos = await createTestPosition({ orgId: region.id });

      // Deactivate one position
      await db
        .update(schema.positions)
        .set({ isActive: false })
        .where(eq(schema.positions.id, inactivePos.id));

      await createTestAssignment(activePos.id, region.id, user.id);
      await createTestAssignment(inactivePos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]!.positionId).toBe(activePos.id);
    });

    it("should exclude inactive users by default", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const activeUser = await createTestUser();
      const inactiveUser = await createTestUser();

      // Deactivate one user
      await db
        .update(schema.users)
        .set({ status: "inactive" })
        .where(eq(schema.users.id, inactiveUser.id));

      const pos = await createTestPosition({ orgId: region.id });
      await createTestAssignment(pos.id, region.id, activeUser.id);
      await createTestAssignment(pos.id, region.id, inactiveUser.id);

      const client = createTestClient();
      const activeResult = await client.position.getAssignmentsByUserId({
        userId: activeUser.id,
      });
      const inactiveResult = await client.position.getAssignmentsByUserId({
        userId: inactiveUser.id,
      });

      expect(activeResult.assignments).toHaveLength(1);
      expect(inactiveResult.assignments).toHaveLength(0);
    });

    it("should include inactive when includeInactive is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();
      const activePos = await createTestPosition({ orgId: region.id });
      const inactivePos = await createTestPosition({ orgId: region.id });

      // Deactivate one position
      await db
        .update(schema.positions)
        .set({ isActive: false })
        .where(eq(schema.positions.id, inactivePos.id));

      await createTestAssignment(activePos.id, region.id, user.id);
      await createTestAssignment(inactivePos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
        includeInactive: true,
      });

      expect(result.assignments).toHaveLength(2);
    });

    it("should include inactive users when includeInactive is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      const user = await createTestUser();

      // Deactivate user
      await db
        .update(schema.users)
        .set({ status: "inactive" })
        .where(eq(schema.users.id, user.id));

      const pos = await createTestPosition({ orgId: region.id });
      await createTestAssignment(pos.id, region.id, user.id);

      const client = createTestClient();
      const result = await client.position.getAssignmentsByUserId({
        userId: user.id,
        includeInactive: true,
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]!.positionId).toBe(pos.id);
    });
  });
});
