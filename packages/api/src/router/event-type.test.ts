/**
 * Tests for Event Type Router endpoints
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

describe("Event Type Router", () => {
  // Track created event types for cleanup
  const createdEventTypeIds: number[] = [];

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
    // Clean up all created event types in reverse order
    for (const eventTypeId of createdEventTypeIds.reverse()) {
      try {
        await cleanup.eventType(eventTypeId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe("all", () => {
    it("should return a list of event types", async () => {
      const client = createTestClient();
      const result = await client.eventType.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("eventTypes");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.eventTypes)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.eventType.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.eventType.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.eventTypes.length).toBeLessThanOrEqual(2);
      expect(page2.eventTypes.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 event types
      if (
        page1.totalCount > 2 &&
        page1.eventTypes.length > 0 &&
        page2.eventTypes.length > 0
      ) {
        expect(page1.eventTypes[0]?.id).not.toBe(page2.eventTypes[0]?.id);
      }
    });

    it("should return only active national event types when nationalOnly is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nationOrg = await getOrCreateF3NationOrg();
      const nationalName = `NAT_FILTER_${uniqueId()}`;
      const nationalNameB = `NAT_FILTER_B_${uniqueId()}`;

      const [inactiveNational] = await db
        .insert(schema.eventTypes)
        .values({
          name: `NAT_INACTIVE_${uniqueId()}`,
          eventCategory: "first_f",
          isActive: false,
          specificOrgId: null,
        })
        .returning();
      if (inactiveNational) createdEventTypeIds.push(inactiveNational.id);

      const [orgSpecific] = await db
        .insert(schema.eventTypes)
        .values({
          name: `ORG_SPEC_${uniqueId()}`,
          eventCategory: "first_f",
          isActive: true,
          specificOrgId: nationOrg.id,
        })
        .returning();
      if (orgSpecific) createdEventTypeIds.push(orgSpecific.id);

      const [nationalA] = await db
        .insert(schema.eventTypes)
        .values({
          name: nationalNameB,
          eventCategory: "first_f",
          isActive: true,
          specificOrgId: null,
        })
        .returning();
      if (nationalA) createdEventTypeIds.push(nationalA.id);

      const [nationalB] = await db
        .insert(schema.eventTypes)
        .values({
          name: nationalName,
          eventCategory: "first_f",
          isActive: true,
          specificOrgId: null,
        })
        .returning();
      if (nationalB) createdEventTypeIds.push(nationalB.id);

      const client = createTestClient();
      const result = await client.eventType.all({
        nationalOnly: true,
        statuses: ["active"],
        sorting: [{ id: "name", desc: false }],
      });

      const ids = result.eventTypes.map((r) => r.id);
      expect(ids).toContain(nationalA?.id);
      expect(ids).toContain(nationalB?.id);
      expect(ids).not.toContain(inactiveNational?.id);
      expect(ids).not.toContain(orgSpecific?.id);

      const names = result.eventTypes.map((r) => r.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it("should reject nationalOnly combined with orgIds", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nationOrg = await getOrCreateF3NationOrg();
      const client = createTestClient();

      await expect(
        client.eventType.all({
          nationalOnly: true,
          orgIds: [nationOrg.id],
        }),
      ).rejects.toThrow();
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create a uniquely named event type to search for
      const uniqueName = `SearchTest ${uniqueId()}`;
      const [created] = await db
        .insert(schema.eventTypes)
        .values({
          name: uniqueName,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (created) {
        createdEventTypeIds.push(created.id);
      }

      const result = await client.eventType.all({
        searchTerm: uniqueName.split(" ")[0], // Search for "SearchTest"
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should match search term
      const found = result.eventTypes.some((et) => et.id === created?.id);
      expect(found).toBe(true);
    });

    it("should filter by org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      const client = createTestClient();
      const result = await client.eventType.all({
        orgIds: [f3Nation.id],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("eventTypes");
      expect(Array.isArray(result.eventTypes)).toBe(true);
    });

    it("should return correct event types when filtering by regionId", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const client = createTestClient();

      // Create two test regions
      const [region1] = await db
        .insert(schema.orgs)
        .values({
          name: `Test Region 1 ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      const [region2] = await db
        .insert(schema.orgs)
        .values({
          name: `Test Region 2 ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!region1 || !region2) {
        throw new Error("Failed to create test regions");
      }

      // Create event types for region1
      const [region1EventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Region 1 Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          specificOrgId: region1.id,
          isActive: true,
        })
        .returning();

      // Create event types for region2
      const [region2EventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Region 2 Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          specificOrgId: region2.id,
          isActive: true,
        })
        .returning();

      // Create Nation event type (no specificOrgId)
      const [nationEventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Nation Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          specificOrgId: null,
          isActive: true,
        })
        .returning();

      if (region1EventType) {
        createdEventTypeIds.push(region1EventType.id);
      }
      if (region2EventType) {
        createdEventTypeIds.push(region2EventType.id);
      }
      if (nationEventType) {
        createdEventTypeIds.push(nationEventType.id);
      }

      // Test: Filtering by region1 should return region1's event types + Nation event types
      const result = await client.eventType.all({
        orgIds: [region1.id],
        pageIndex: 0,
        pageSize: 100,
      });

      expect(result).toHaveProperty("eventTypes");
      expect(Array.isArray(result.eventTypes)).toBe(true);

      // Should include region1's event type
      if (region1EventType) {
        const foundRegion1Type = result.eventTypes.some(
          (et) => et.id === region1EventType.id,
        );
        expect(foundRegion1Type).toBe(true);
      }

      // Should include Nation event type
      if (nationEventType) {
        const foundNationType = result.eventTypes.some(
          (et) => et.id === nationEventType.id,
        );
        expect(foundNationType).toBe(true);
      }

      // Should NOT include region2's event type
      if (region2EventType) {
        const foundRegion2Type = result.eventTypes.some(
          (et) => et.id === region2EventType.id,
        );
        expect(foundRegion2Type).toBe(false);
      }

      // Cleanup regions
      try {
        await cleanup.org(region1.id);
        await cleanup.org(region2.id);
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  describe("byId", () => {
    it("should return an event type by ID", async () => {
      const client = createTestClient();

      // Get a test event type ID
      const [testEventType] = await db
        .select({ id: schema.eventTypes.id })
        .from(schema.eventTypes)
        .limit(1);

      if (testEventType) {
        const result = await client.eventType.byId({
          id: testEventType.id,
        });

        expect(result).toHaveProperty("eventType");
        expect(result.eventType).not.toBeNull();
        expect(result.eventType?.id).toBe(testEventType.id);
      }
    });

    it("should throw NOT_FOUND for non-existent event type", async () => {
      const client = createTestClient();

      await expect(
        client.eventType.byId({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("byOrgId", () => {
    it("should return event types for a specific org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an event type for this org
      const [created] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Org Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          specificOrgId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (created) {
        createdEventTypeIds.push(created.id);
      }

      const result = await client.eventType.byOrgId({
        orgId: f3Nation.id,
      });

      expect(result).toHaveProperty("eventTypes");
      expect(Array.isArray(result.eventTypes)).toBe(true);

      // Should include our created event type
      if (created) {
        const found = result.eventTypes.some((et) => et.id === created.id);
        expect(found).toBe(true);
      }
    });

    it("should return empty for non-existent org", async () => {
      const client = createTestClient();
      const result = await client.eventType.byOrgId({
        orgId: 999999,
      });

      expect(result.eventTypes).toEqual([]);
    });
  });

  describe("crupdate", () => {
    it("should create a new event type for nation", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const eventTypeName = `Test Event Type ${uniqueId()}`;

      const result = await client.eventType.crupdate({
        name: eventTypeName,
        eventCategory: "first_f",
        isActive: true,
      });

      expect(result).toHaveProperty("eventType");
      expect(Array.isArray(result.eventType)).toBe(true);
      expect(result.eventType?.length).toBeGreaterThan(0);

      const created = result.eventType?.[0];
      if (created) {
        expect(created.name).toBe(eventTypeName);
        createdEventTypeIds.push(created.id);
      }
    });

    it("should create an event type for a specific org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const eventTypeName = `Org Specific Event Type ${uniqueId()}`;

      const result = await client.eventType.crupdate({
        name: eventTypeName,
        eventCategory: "second_f",
        specificOrgId: f3Nation.id,
        isActive: true,
      });

      expect(result).toHaveProperty("eventType");
      expect(Array.isArray(result.eventType)).toBe(true);

      const created = result.eventType?.[0];
      if (created) {
        expect(created.name).toBe(eventTypeName);
        expect(created.specificOrgId).toBe(f3Nation.id);
        createdEventTypeIds.push(created.id);
      }
    });

    it("should update an existing event type", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an event type first
      const [testEventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Original Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!testEventType) {
        return;
      }
      createdEventTypeIds.push(testEventType.id);

      // Update it
      const updatedName = `Updated Event Type ${uniqueId()}`;
      const result = await client.eventType.crupdate({
        id: testEventType.id,
        name: updatedName,
        eventCategory: "third_f",
        isActive: true,
      });

      expect(result).toHaveProperty("eventType");
      const updated = result.eventType?.[0];
      expect(updated?.id).toBe(testEventType.id);
      expect(updated?.name).toBe(updatedName);
    });

    it("should require editor permission for org-specific event types", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      // Create a session with no permission on F3 Nation
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.eventType.crupdate({
          name: "Unauthorized Event Type",
          eventCategory: "first_f",
          specificOrgId: f3Nation.id,
          isActive: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("should soft delete an event type (mark as inactive)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an event type to delete
      const [testEventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Delete Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!testEventType) {
        return;
      }
      createdEventTypeIds.push(testEventType.id);

      // Delete it
      await client.eventType.delete({
        id: testEventType.id,
      });

      // Verify it's marked as inactive
      const [deletedEventType] = await db
        .select()
        .from(schema.eventTypes)
        .where(eq(schema.eventTypes.id, testEventType.id));

      expect(deletedEventType?.isActive).toBe(false);
    });

    it("should require editor permission to delete", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create an event type for a specific org
      const [testEventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Delete Auth Test ${uniqueId()}`,
          eventCategory: "first_f",
          specificOrgId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!testEventType) {
        return;
      }
      createdEventTypeIds.push(testEventType.id);

      // Now try to delete with a session that doesn't have permission
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.eventType.delete({
          id: testEventType.id,
        }),
      ).rejects.toThrow();
    });
  });
});
