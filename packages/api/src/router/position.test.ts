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
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

import { and, eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("Position Router", () => {
  // Track created resources for cleanup
  const createdPositionIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];

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
    // Clean up in reverse order respecting FK constraints
    // First delete position assignments
    for (const positionId of createdPositionIds) {
      try {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(eq(schema.positionsXOrgsXUsers.positionId, positionId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Then delete positions
    for (const positionId of createdPositionIds.reverse()) {
      try {
        await db
          .delete(schema.positions)
          .where(eq(schema.positions.id, positionId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Delete users
    for (const userId of createdUserIds.reverse()) {
      try {
        await cleanup.user(userId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Delete orgs
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  // Helper to create a test region
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

    if (region) {
      createdOrgIds.push(region.id);
    }
    return region;
  };

  // Helper to create a test position
  const createTestPosition = async (options?: {
    name?: string;
    orgId?: number | null;
    orgType?: "ao" | "region" | "area" | "sector" | "nation" | null;
    isActive?: boolean;
  }) => {
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: options?.name ?? `Test Position ${uniqueId()}`,
        orgId: options?.orgId ?? null,
        orgType: options?.orgType ?? null,
        isActive: options?.isActive ?? true,
      })
      .returning();

    if (position) {
      createdPositionIds.push(position.id);
    }
    return position;
  };

  // Helper to create a test user
  const createTestUser = async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `test-${uniqueId()}@example.com`,
        f3Name: `TestUser ${uniqueId()}`,
      })
      .returning();

    if (user) {
      createdUserIds.push(user.id);
    }
    return user;
  };

  describe("all", () => {
    it("should return a list of positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.position.all({});

      expect(result).toHaveProperty("positions");
      expect(Array.isArray(result.positions)).toBe(true);
    });

    it("should filter by active status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.position.all({
        isActive: true,
      });

      expect(result.positions.every((p) => p.isActive === true)).toBe(true);
    });

    it("should filter by org ID (including global positions)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create org-specific position
      const orgPosition = await createTestPosition({
        orgId: region.id,
        name: `Region Position ${uniqueId()}`,
      });

      // Create global position
      const globalPosition = await createTestPosition({
        orgId: null,
        name: `Global Position ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.all({
        orgId: region.id,
      });

      // Should include org-specific position
      const foundOrgPosition = result.positions.some(
        (p) => p.id === orgPosition?.id,
      );
      expect(foundOrgPosition).toBe(true);

      // Should also include global position (since ignoreGlobalPositions is false by default)
      const foundGlobalPosition = result.positions.some(
        (p) => p.id === globalPosition?.id,
      );
      expect(foundGlobalPosition).toBe(true);
    });

    it("should exclude global positions when ignoreGlobalPositions is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create org-specific position
      const orgPosition = await createTestPosition({
        orgId: region.id,
        name: `Region Position ${uniqueId()}`,
      });

      // Create global position
      const globalPosition = await createTestPosition({
        orgId: null,
        name: `Global Position ${uniqueId()}`,
      });

      const client = createTestClient();
      const result = await client.position.all({
        orgId: region.id,
        ignoreGlobalPositions: true,
      });

      // Should include org-specific position
      const foundOrgPosition = result.positions.some(
        (p) => p.id === orgPosition?.id,
      );
      expect(foundOrgPosition).toBe(true);

      // Should NOT include global position
      const foundGlobalPosition = result.positions.some(
        (p) => p.id === globalPosition?.id,
      );
      expect(foundGlobalPosition).toBe(false);
    });

    it("should filter by org type", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create positions for different org types
      const aoPosition = await createTestPosition({
        name: `AO Position ${uniqueId()}`,
        orgType: "ao",
      });

      await createTestPosition({
        name: `Region Position ${uniqueId()}`,
        orgType: "region",
      });

      const client = createTestClient();
      const result = await client.position.all({
        orgType: "ao",
      });

      // Should include AO position or global positions that apply to AOs
      const foundAoPosition = result.positions.some(
        (p) => p.id === aoPosition?.id,
      );
      expect(foundAoPosition).toBe(true);
    });
  });

  describe("byOrgId", () => {
    it("should return positions for a specific org only", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create position for this org
      const orgPosition = await createTestPosition({
        orgId: region.id,
      });

      const client = createTestClient();
      const result = await client.position.byOrgId({
        orgId: region.id,
      });

      expect(result).toHaveProperty("positions");
      expect(Array.isArray(result.positions)).toBe(true);

      // Should include our created position
      const found = result.positions.some((p) => p.id === orgPosition?.id);
      expect(found).toBe(true);

      // All positions should belong to this org
      expect(result.positions.every((p) => p.orgId === region.id)).toBe(true);
    });

    it("should return empty for org with no positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const client = createTestClient();
      const result = await client.position.byOrgId({
        orgId: region.id,
      });

      expect(result.positions).toEqual([]);
    });

    it("should filter by active status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create active and inactive positions
      await createTestPosition({
        orgId: region.id,
        isActive: true,
      });

      await createTestPosition({
        orgId: region.id,
        isActive: false,
      });

      const client = createTestClient();
      const result = await client.position.byOrgId({
        orgId: region.id,
        isActive: true,
      });

      expect(result.positions.every((p) => p.isActive === true)).toBe(true);
    });
  });

  describe("byId", () => {
    it("should return position by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const position = await createTestPosition();
      if (!position) return;

      const client = createTestClient();
      const result = await client.position.byId({
        id: position.id,
      });

      expect(result).toHaveProperty("position");
      expect(result.position).not.toBeNull();
      expect(result.position?.id).toBe(position.id);
    });

    it("should throw NOT_FOUND for non-existent position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.position.byId({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("getAssignments", () => {
    it("should return positions with assigned users", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const user = await createTestUser();
      if (!user) return;

      // Create assignment
      await db.insert(schema.positionsXOrgsXUsers).values({
        positionId: position.id,
        orgId: region.id,
        userId: user.id,
      });

      const client = createTestClient();
      const result = await client.position.getAssignments({
        orgId: region.id,
      });

      expect(result).toHaveProperty("positions");
      expect(Array.isArray(result.positions)).toBe(true);

      // Find our position and check user assignment
      const foundPosition = result.positions.find(
        (p) => p.id === position.id,
      );
      if (foundPosition) {
        expect(foundPosition.userIds).toContain(user.id);
      }
    });

    it("should return positions with empty userIds when no assignments", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      await createTestPosition({
        orgId: region.id,
      });

      const client = createTestClient();
      const result = await client.position.getAssignments({
        orgId: region.id,
      });

      // All positions should have userIds array (possibly empty)
      expect(
        result.positions.every((p) => Array.isArray(p.userIds)),
      ).toBe(true);
    });
  });

  describe("crupdate", () => {
    it("should create a new position for an org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const client = createTestClient();
      const positionName = `New Position ${uniqueId()}`;

      const result = await client.position.crupdate({
        name: positionName,
        orgId: region.id,
        isActive: true,
      });

      expect(result).toHaveProperty("position");
      expect(result.position).not.toBeNull();
      expect(result.position?.name).toBe(positionName);
      expect(result.position?.orgId).toBe(region.id);

      if (result.position?.id) {
        createdPositionIds.push(result.position.id);
      }
    });

    it("should update an existing position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const client = createTestClient();
      const updatedName = `Updated Position ${uniqueId()}`;

      const result = await client.position.crupdate({
        id: position.id,
        name: updatedName,
        orgId: region.id,
        isActive: true,
      });

      expect(result.position?.id).toBe(position.id);
      expect(result.position?.name).toBe(updatedName);
    });

    it("should require editor role for org-specific positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create session without editor role
      const noPermSession = {
        id: 999,
        email: "noperm@example.com",
        user: {
          id: "999",
          email: "noperm@example.com",
          name: "No Permission User",
          roles: [],
        },
        roles: [],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.position.crupdate({
          name: `Unauthorized Position ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("should soft delete org-specific position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const client = createTestClient();
      const result = await client.position.delete({
        id: position.id,
      });

      expect(result).toHaveProperty("positionId");
      expect(result.positionId).toBe(position.id);

      // Verify soft deletion (isActive should be false)
      const [deleted] = await db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.id, position.id));

      expect(deleted).toBeDefined();
      expect(deleted?.isActive).toBe(false);
    });

    it("should throw NOT_FOUND for non-existent position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.position.delete({
          id: 999999,
        }),
      ).rejects.toThrow();
    });

    it("should throw FORBIDDEN for global positions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create a global position (no orgId)
      const globalPosition = await createTestPosition({
        orgId: null,
      });
      if (!globalPosition) return;

      const client = createTestClient();

      await expect(
        client.position.delete({
          id: globalPosition.id,
        }),
      ).rejects.toThrow();
    });

    it("should delete position assignments when deleting position", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const user = await createTestUser();
      if (!user) return;

      // Create assignment
      await db.insert(schema.positionsXOrgsXUsers).values({
        positionId: position.id,
        orgId: region.id,
        userId: user.id,
      });

      const client = createTestClient();
      await client.position.delete({
        id: position.id,
      });

      // Verify assignment was deleted
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(eq(schema.positionsXOrgsXUsers.positionId, position.id));

      expect(assignments.length).toBe(0);
    });
  });

  describe("updateAssignments", () => {
    it("should replace position assignments for an org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const user1 = await createTestUser();
      const user2 = await createTestUser();
      if (!user1 || !user2) return;

      const client = createTestClient();
      const result = await client.position.updateAssignments({
        orgId: region.id,
        assignments: [
          {
            positionId: position.id,
            userIds: [user1.id, user2.id],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.assignmentCount).toBe(2);

      // Verify assignments were created
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, position.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
          ),
        );

      expect(assignments.length).toBe(2);
      const assignedUserIds = assignments.map((a) => a.userId);
      expect(assignedUserIds).toContain(user1.id);
      expect(assignedUserIds).toContain(user2.id);
    });

    it("should clear existing assignments when updating", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const user1 = await createTestUser();
      const user2 = await createTestUser();
      if (!user1 || !user2) return;

      // Create initial assignment for user1
      await db.insert(schema.positionsXOrgsXUsers).values({
        positionId: position.id,
        orgId: region.id,
        userId: user1.id,
      });

      const client = createTestClient();

      // Update assignments to only include user2
      const result = await client.position.updateAssignments({
        orgId: region.id,
        assignments: [
          {
            positionId: position.id,
            userIds: [user2.id],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.assignmentCount).toBe(1);

      // Verify only user2 is now assigned
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, position.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
          ),
        );

      expect(assignments.length).toBe(1);
      expect(assignments[0]?.userId).toBe(user2.id);
    });

    it("should handle empty assignments to clear all", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const position = await createTestPosition({
        orgId: region.id,
      });
      if (!position) return;

      const user = await createTestUser();
      if (!user) return;

      // Create initial assignment
      await db.insert(schema.positionsXOrgsXUsers).values({
        positionId: position.id,
        orgId: region.id,
        userId: user.id,
      });

      const client = createTestClient();

      // Update with empty userIds to clear assignments
      const result = await client.position.updateAssignments({
        orgId: region.id,
        assignments: [
          {
            positionId: position.id,
            userIds: [],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.assignmentCount).toBe(0);

      // Verify all assignments were cleared
      const assignments = await db
        .select()
        .from(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, position.id),
            eq(schema.positionsXOrgsXUsers.orgId, region.id),
          ),
        );

      expect(assignments.length).toBe(0);
    });
  });
});
