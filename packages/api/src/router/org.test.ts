/**
 * Tests for Org Router endpoints
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

import { eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("Org Router", () => {
  // Track created orgs for cleanup
  const createdOrgIds: number[] = [];

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
    // Clean up all created orgs in reverse order
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe("all", () => {
    it("should return a list of orgs with required orgTypes", async () => {
      const client = createTestClient();
      const result = await client.org.all({
        orgTypes: ["region"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("orgs");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.orgs)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.org.all({
        orgTypes: ["region"],
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.org.all({
        orgTypes: ["region"],
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.orgs.length).toBeLessThanOrEqual(2);
      expect(page2.orgs.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 orgs
      if (page1.total > 2 && page1.orgs.length > 0 && page2.orgs.length > 0) {
        expect(page1.orgs[0]?.id).not.toBe(page2.orgs[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeOrgs = await client.org.all({
        orgTypes: ["region"],
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeOrgs.orgs.every((o) => o.isActive === true)).toBe(true);
    });

    it("should search by name", async () => {
      const client = createTestClient();
      const result = await client.org.all({
        orgTypes: ["region", "ao", "nation"],
        searchTerm: "F3",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should match search term in name or description
      result.orgs.forEach((org) => {
        const searchLower = "f3".toLowerCase();
        const matches =
          org.name?.toLowerCase().includes(searchLower) ||
          org.description?.toLowerCase().includes(searchLower);
        expect(matches).toBe(true);
      });
    });
  });

  describe("byId", () => {
    it("should return an org by ID", async () => {
      const client = createTestClient();

      // Get a test org ID
      const [testOrg] = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .limit(1);

      if (testOrg) {
        const result = await client.org.byId({
          id: testOrg.id,
        });

        expect(result).toHaveProperty("org");
        expect(result.org).not.toBeNull();
        expect(result.org?.id).toBe(testOrg.id);
      }
    });

    it("should return null for non-existent org", async () => {
      const client = createTestClient();
      const result = await client.org.byId({
        id: 999999,
      });

      expect(result.org).toBeNull();
    });
  });

  describe("crupdate", () => {
    it("should create a new region org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const orgName = `Test Region ${uniqueId()}`;

      const result = await client.org.crupdate({
        name: orgName,
        orgType: "region",
        parentId: f3Nation.id,
        isActive: true,
        email: "test@example.com",
      });

      expect(result).toHaveProperty("org");
      expect(result.org).not.toBeNull();
      expect(result.org?.name).toBe(orgName);
      expect(result.org?.orgType).toBe("region");

      if (result.org) {
        createdOrgIds.push(result.org.id);
      }
    });

    it("should require parentId or id", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Test Org",
          orgType: "region",
          isActive: true,
          email: "test@example.com",
        }),
      ).rejects.toThrow("Parent ID or ID is required");
    });

    it("should update an existing org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an org first
      const [testOrg] = await db
        .insert(schema.orgs)
        .values({
          name: `Original Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!testOrg) {
        return;
      }
      createdOrgIds.push(testOrg.id);

      // Update it
      const updatedName = `Updated Region ${uniqueId()}`;
      const result = await client.org.crupdate({
        id: testOrg.id,
        name: updatedName,
        orgType: "region",
        parentId: f3Nation.id,
        isActive: true,
        email: "test@example.com",
      });

      expect(result.org?.id).toBe(testOrg.id);
      expect(result.org?.name).toBe(updatedName);
    });

    it("should enforce editor permissions", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      // Create a session with editor role on a different org
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Unauthorized Org",
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
          email: "test@example.com",
        }),
      ).rejects.toThrow();
    });
  });

  describe("mine", () => {
    it("should return empty array when user has no orgs", async () => {
      const session = await createAdminSession();
      // Override with a user that has no roles assigned in the DB
      session.id = 999999;
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.org.mine();

      expect(result).toHaveProperty("orgs");
      expect(Array.isArray(result.orgs)).toBe(true);
    });
  });

  describe("delete", () => {
    it("should soft delete an org (mark as inactive)", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an org to delete
      const [testOrg] = await db
        .insert(schema.orgs)
        .values({
          name: `Delete Test Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!testOrg) {
        return;
      }
      createdOrgIds.push(testOrg.id);

      // Delete it
      const result = await client.org.delete({
        id: testOrg.id,
      });

      expect(result.orgId).toBe(testOrg.id);

      // Verify it's marked as inactive
      const [deletedOrg] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, testOrg.id));

      expect(deletedOrg?.isActive).toBe(false);
    });

    it("should require admin permission to delete", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      // Create a session with no admin role
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Try to delete F3 Nation (should fail)
      await expect(
        client.org.delete({
          id: f3Nation.id,
        }),
      ).rejects.toThrow();
    });
  });
});
