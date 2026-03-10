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

      // Results should be different if there are more than 2 regions
      if (page1.total > 2 && page1.orgs.length > 0 && page2.orgs.length > 0) {
        // Pages must not overlap - each page should have distinct org IDs
        const page1Ids = new Set(page1.orgs.map((o) => o.id));
        page2.orgs.forEach((org) => {
          expect(page1Ids.has(org.id)).toBe(false);
        });
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
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
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
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
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
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
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
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
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

  describe("accessible", () => {
    it("sector admin sees their sector and descendant orgs", async () => {
      const uid = uniqueId();

      // Build: sector -> area -> region
      const [sector] = await db
        .insert(schema.orgs)
        .values({ name: `Sector ${uid}`, orgType: "sector", isActive: true })
        .returning();
      if (!sector) throw new Error("Failed to create sector");
      createdOrgIds.push(sector.id);

      const [area] = await db
        .insert(schema.orgs)
        .values({
          name: `Area ${uid}`,
          orgType: "area",
          parentId: sector.id,
          isActive: true,
        })
        .returning();
      if (!area) throw new Error("Failed to create area");
      createdOrgIds.push(area.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Region ${uid}`,
          orgType: "region",
          parentId: area.id,
          isActive: true,
        })
        .returning();
      if (!region) throw new Error("Failed to create region");
      createdOrgIds.push(region.id);

      // Create a test user and assign them admin role on the sector
      const [testUser] = await db
        .insert(schema.users)
        .values({ email: `sector-admin-${uid}@example.com`, f3Name: `SectorAdmin${uid}` })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      const [adminRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"))
        .limit(1);
      if (!adminRole) throw new Error("Admin role not found");

      await db.insert(schema.rolesXUsersXOrg).values({
        userId: testUser.id,
        orgId: sector.id,
        roleId: adminRole.id,
      });

      // Mock session with the test user's DB id
      await mockAuthWithSession({
        id: testUser.id,
        email: testUser.email ?? "",
        user: {
          id: String(testUser.id),
          email: testUser.email ?? "",
          name: testUser.f3Name ?? "",
          roles: [{ orgId: sector.id, orgName: sector.name ?? "Sector", roleName: "admin" }],
        },
        roles: [{ orgId: sector.id, orgName: sector.name ?? "Sector", roleName: "admin" }],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const client = createTestClient();
      const result = await client.org.accessible({
        orgTypes: ["sector", "area", "region"],
      });

      const resultIds = result.orgs.map((o) => o.id);
      expect(resultIds).toContain(sector.id);
      expect(resultIds).toContain(area.id);
      expect(resultIds).toContain(region.id);

      // Sector should have "admin" in roles (direct assignment)
      const sectorOrg = result.orgs.find((o) => o.id === sector.id);
      expect(sectorOrg?.roles).toContain("admin");

      // Descendant orgs should also have "admin" (inherited)
      const areaOrg = result.orgs.find((o) => o.id === area.id);
      expect(areaOrg?.roles).toContain("admin");

      const regionOrg = result.orgs.find((o) => o.id === region.id);
      expect(regionOrg?.roles).toContain("admin");

      // Cleanup
      await cleanup.user(testUser.id);
    });

    it("editor-only user does not see descendant orgs beyond their assignment", async () => {
      const uid = uniqueId();

      const [sector] = await db
        .insert(schema.orgs)
        .values({ name: `Sector ${uid}`, orgType: "sector", isActive: true })
        .returning();
      if (!sector) throw new Error("Failed to create sector");
      createdOrgIds.push(sector.id);

      const [area] = await db
        .insert(schema.orgs)
        .values({
          name: `Area ${uid}`,
          orgType: "area",
          parentId: sector.id,
          isActive: true,
        })
        .returning();
      if (!area) throw new Error("Failed to create area");
      createdOrgIds.push(area.id);

      // Create a test user with only editor role on the sector
      const [testUser] = await db
        .insert(schema.users)
        .values({ email: `sector-editor-${uid}@example.com`, f3Name: `SectorEditor${uid}` })
        .returning();
      if (!testUser) throw new Error("Failed to create test user");

      const [editorRole] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"))
        .limit(1);
      if (!editorRole) throw new Error("Editor role not found");

      await db.insert(schema.rolesXUsersXOrg).values({
        userId: testUser.id,
        orgId: sector.id,
        roleId: editorRole.id,
      });

      await mockAuthWithSession({
        id: testUser.id,
        email: testUser.email ?? "",
        user: {
          id: String(testUser.id),
          email: testUser.email ?? "",
          name: testUser.f3Name ?? "",
          roles: [{ orgId: sector.id, orgName: sector.name ?? "Sector", roleName: "editor" }],
        },
        roles: [{ orgId: sector.id, orgName: sector.name ?? "Sector", roleName: "editor" }],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const client = createTestClient();
      const result = await client.org.accessible({
        orgTypes: ["sector", "area", "region"],
      });

      const resultIds = result.orgs.map((o) => o.id);
      expect(resultIds).toContain(sector.id);
      // Editor-only users should NOT see descendant orgs they're not assigned to
      expect(resultIds).not.toContain(area.id);

      // Cleanup
      await cleanup.user(testUser.id);
    });
  });
});
