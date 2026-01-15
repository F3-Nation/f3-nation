/**
 * Tests for Location Router endpoints
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

describe("Location Router", () => {
  // Track created locations for cleanup
  const createdLocationIds: number[] = [];
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
    // Clean up all created locations in reverse order
    for (const locationId of createdLocationIds.reverse()) {
      try {
        await cleanup.location(locationId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Clean up created orgs
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

  describe("all", () => {
    it("should return a list of locations", async () => {
      const client = createTestClient();
      const result = await client.location.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("locations");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.locations)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.location.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.location.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.locations.length).toBeLessThanOrEqual(2);
      expect(page2.locations.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 locations
      if (
        page1.totalCount > 2 &&
        page1.locations.length > 0 &&
        page2.locations.length > 0
      ) {
        expect(page1.locations[0]?.id).not.toBe(page2.locations[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeLocations = await client.location.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeLocations.locations.every((l) => l.isActive === true)).toBe(
        true,
      );
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create a test region and location with unique name
      const region = await createTestRegion();
      if (!region) return;

      const uniqueName = `SearchableLocation ${uniqueId()}`;
      const [created] = await db
        .insert(schema.locations)
        .values({
          name: uniqueName,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (created) {
        createdLocationIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.location.all({
        searchTerm: "SearchableLocation",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created location
      const found = result.locations.some((l) => l.id === created?.id);
      expect(found).toBe(true);
    });

    it("should filter by region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location in this region
      const [created] = await db
        .insert(schema.locations)
        .values({
          name: `Region Filter Test ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (created) {
        createdLocationIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.location.all({
        regionIds: [region.id],
        pageIndex: 0,
        pageSize: 10,
      });

      // All results should be in the specified region
      expect(result.locations.every((l) => l.regionId === region.id)).toBe(
        true,
      );
    });
  });

  describe("byId", () => {
    it("should return a location by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a test location
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `ById Test ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      const client = createTestClient();
      const result = await client.location.byId({
        id: testLocation.id,
      });

      expect(result).toHaveProperty("location");
      expect(result.location).not.toBeNull();
      expect(result.location?.id).toBe(testLocation.id);
    });

    it("should return null for non-existent location", async () => {
      const client = createTestClient();
      const result = await client.location.byId({
        id: 999999,
      });

      expect(result.location).toBeNull();
    });
  });

  describe("crupdate", () => {
    it("should create a new location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Give the session editor permission on this region
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const locationName = `Test Location ${uniqueId()}`;

      const result = await client.location.crupdate({
        name: locationName,
        orgId: region.id,
        latitude: 35.5,
        longitude: -80.5,
        addressStreet: "123 Test St",
        addressCity: "Test City",
        addressState: "NC",
        addressZip: "28000",
        addressCountry: "USA",
        isActive: true,
      });

      expect(result).toHaveProperty("location");
      expect(result.location).not.toBeNull();
      expect(result.location?.name).toBe(locationName);

      if (result.location) {
        createdLocationIds.push(result.location.id);
      }
    });

    it("should require orgId", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.location.crupdate({
          name: "No Org Location",
          // @ts-expect-error - undefined is needed for the test
          orgId: undefined,
          latitude: 35.0,
          longitude: -80.0,
          isActive: true,
        }),
      ).rejects.toThrow();
    });

    it("should update an existing location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location first
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `Original Location ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      // Give the session editor permission on this region
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const updatedName = `Updated Location ${uniqueId()}`;

      const result = await client.location.crupdate({
        id: testLocation.id,
        name: updatedName,
        orgId: region.id,
        latitude: 36.0,
        longitude: -81.0,
        isActive: true,
      });

      expect(result.location?.id).toBe(testLocation.id);
      expect(result.location?.name).toBe(updatedName);
    });

    it("should enforce editor permissions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a session with no permission on this region
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.location.crupdate({
          name: "Unauthorized Location",
          orgId: region.id,
          latitude: 35.0,
          longitude: -80.0,
          isActive: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("should soft delete a location (mark as inactive)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location to delete
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `Delete Test Location ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      // Give the session admin permission on this region
      const adminSession = await createAdminSession();
      // Also add admin role for the region
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: region.id,
          orgName: region.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: region.id,
          orgName: region.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const client = createTestClient();

      const result = await client.location.delete({
        id: testLocation.id,
      });

      expect(result.locationId).toBe(testLocation.id);

      // Verify it's marked as inactive
      const [deletedLocation] = await db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, testLocation.id));

      expect(deletedLocation?.isActive).toBe(false);
    });

    it("should require admin permission to delete", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `Delete Auth Test ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.0,
          longitude: -80.0,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      // Create a session with only editor permission (not admin)
      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await expect(
        client.location.delete({
          id: testLocation.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("inBoundingBox", () => {
    it("should return locations within bounding box", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location within a specific bounding box
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `BoundingBox Test ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 35.5,
          longitude: -80.5,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      const client = createTestClient();

      const result = await client.location.inBoundingBox({
        minLat: 35.0,
        maxLat: 36.0,
        minLng: -81.0,
        maxLng: -80.0,
      });

      expect(result).toHaveProperty("locations");
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("boundingBox");

      // Our location should be in the results
      const found = result.locations.some((l) => l.id === testLocation.id);
      expect(found).toBe(true);
    });

    it("should not return locations outside bounding box", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a location outside the bounding box we'll query
      const [testLocation] = await db
        .insert(schema.locations)
        .values({
          name: `Outside BoundingBox ${uniqueId()}`,
          orgId: region.id,
          isActive: true,
          latitude: 40.0, // Way outside
          longitude: -70.0,
        })
        .returning();

      if (!testLocation) return;
      createdLocationIds.push(testLocation.id);

      const client = createTestClient();

      const result = await client.location.inBoundingBox({
        minLat: 35.0,
        maxLat: 36.0,
        minLng: -81.0,
        maxLng: -80.0,
      });

      // Our location should NOT be in the results
      const found = result.locations.some((l) => l.id === testLocation.id);
      expect(found).toBe(false);
    });

    it("should filter by active status", async () => {
      const client = createTestClient();

      const result = await client.location.inBoundingBox({
        minLat: -90.0,
        maxLat: 90.0,
        minLng: -180.0,
        maxLng: 180.0,
        isActive: true,
      });

      // All returned locations should be active
      expect(result.locations.every((l) => l.isActive === true)).toBe(true);
    });
  });
});
