/**
 * Tests for Event Instance Router endpoints
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
import type { SeriesException } from "@acme/shared/app/enums";
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

describe("Event Instance Router", () => {
  // Track created resources for cleanup
  const createdEventInstanceIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdLocationIds: number[] = [];

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
    for (const eventInstanceId of createdEventInstanceIds.reverse()) {
      try {
        // First delete join table records
        await db
          .delete(schema.eventInstancesXEventTypes)
          .where(
            eq(
              schema.eventInstancesXEventTypes.eventInstanceId,
              eventInstanceId,
            ),
          );
        await db
          .delete(schema.eventTagsXEventInstances)
          .where(
            eq(
              schema.eventTagsXEventInstances.eventInstanceId,
              eventInstanceId,
            ),
          );
        await db
          .delete(schema.attendance)
          .where(eq(schema.attendance.eventInstanceId, eventInstanceId));
        // Then delete the event instance
        await db
          .delete(schema.eventInstances)
          .where(eq(schema.eventInstances.id, eventInstanceId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const eventTypeId of createdEventTypeIds.reverse()) {
      try {
        await cleanup.eventType(eventTypeId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const locationId of createdLocationIds.reverse()) {
      try {
        await cleanup.location(locationId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }, 30000); // 30 second timeout for cleanup

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

  // Helper to create a test AO under a region
  const createTestAO = async (regionId: number) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Test AO ${uniqueId()}`,
        orgType: "ao",
        parentId: regionId,
        isActive: true,
      })
      .returning();

    if (ao) {
      createdOrgIds.push(ao.id);
    }
    return ao;
  };

  // Helper to create a test event instance
  const createTestEventInstance = async (
    aoId: number,
    options?: {
      name?: string;
      startDate?: string;
      seriesException?: SeriesException;
    },
  ) => {
    const [eventInstance] = await db
      .insert(schema.eventInstances)
      .values({
        name: options?.name ?? `Test Event ${uniqueId()}`,
        orgId: aoId,
        startDate:
          options?.startDate ?? new Date().toISOString().split("T")[0]!,
        isActive: true,
        highlight: false,
        seriesException: options?.seriesException ?? null,
      })
      .returning();

    if (eventInstance) {
      createdEventInstanceIds.push(eventInstance.id);
    }
    return eventInstance;
  };

  describe("all", () => {
    it("should return a list of event instances", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.eventInstance.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("eventInstances");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.eventInstances)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const page1 = await client.eventInstance.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.eventInstance.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.eventInstances.length).toBeLessThanOrEqual(2);
      expect(page2.eventInstances.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 instances
      if (
        page1.totalCount > 2 &&
        page1.eventInstances.length > 0 &&
        page2.eventInstances.length > 0
      ) {
        expect(page1.eventInstances[0]?.id).not.toBe(
          page2.eventInstances[0]?.id,
        );
      }
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const uniqueName = `SearchableEvent ${uniqueId()}`;
      await createTestEventInstance(ao.id, { name: uniqueName });

      const client = createTestClient();
      const result = await client.eventInstance.all({
        searchTerm: "SearchableEvent",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created event instance
      const found = result.eventInstances.some((e) =>
        e.name?.includes("SearchableEvent"),
      );
      expect(found).toBe(true);
    });

    it("should filter by AO org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result.eventInstances.length).toBeGreaterThanOrEqual(1);
      expect(result.eventInstances.some((e) => e.id === eventInstance.id)).toBe(
        true,
      );
    });

    it("should filter by region org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        regionOrgId: region.id,
        pageIndex: 0,
        pageSize: 10,
      });

      // Should include event instances from AOs in this region
      expect(result.eventInstances.some((e) => e.id === eventInstance.id)).toBe(
        true,
      );
    });

    it("should filter by start date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const futureDateStr = futureDate.toISOString().split("T")[0]!;

      const eventInstance = await createTestEventInstance(ao.id, {
        startDate: futureDateStr,
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        startDate: futureDateStr,
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result.eventInstances.some((e) => e.id === eventInstance.id)).toBe(
        true,
      );
    });

    it("should filter standalone instances only", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create a standalone event instance (no seriesId)
      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        onlyStandalone: true,
        aoOrgId: ao.id,
        pageIndex: 0,
        pageSize: 10,
      });

      // All returned instances should have no seriesId
      expect(result.eventInstances.every((e) => e.seriesId === null)).toBe(
        true,
      );
    });

    it("should return seriesException in list", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        seriesException: "closed",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        pageIndex: 0,
        pageSize: 10,
      });

      const found = result.eventInstances.find(
        (e) => e.id === eventInstance.id,
      );
      expect(found).toBeDefined();
      expect(found?.seriesException).toBe("closed");
    });
  });

  describe("byId", () => {
    it("should return event instance by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(eventInstance.id);
      expect(result?.name).toBe(eventInstance.name);
    });

    it("should return null for non-existent event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: 999999,
      });

      expect(result).toBeNull();
    });

    it("should include event types and tags in response", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create an event type
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (eventType) {
        createdEventTypeIds.push(eventType.id);
      }

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance || !eventType) return;

      // Link event type to event instance
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: eventInstance.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
      });

      expect(result).not.toBeNull();
      expect(result?.eventTypes).toBeDefined();
      expect(Array.isArray(result?.eventTypes)).toBe(true);
    });

    it("should return seriesException in response", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        seriesException: "closed",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
      });

      expect(result).not.toBeNull();
      expect(result?.seriesException).toBe("closed");
    });
  });

  describe("crupdate", () => {
    it("should create a new event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const client = createTestClient();
      const eventName = `New Event ${uniqueId()}`;
      const startDate = new Date().toISOString().split("T")[0]!;

      const result = await client.eventInstance.crupdate({
        name: eventName,
        orgId: ao.id,
        startDate,
        isActive: true,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(eventName);
      expect(result.orgId).toBe(ao.id);

      if (result.id) {
        createdEventInstanceIds.push(result.id);
      }
    });

    it("should update an existing event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const updatedName = `Updated Event ${uniqueId()}`;

      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        name: updatedName,
        orgId: ao.id,
        startDate: eventInstance.startDate,
      });

      expect(result.id).toBe(eventInstance.id);
      expect(result.name).toBe(updatedName);
    });

    it("should create event instance with seriesException", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        name: `Event With Exception ${uniqueId()}`,
        orgId: ao.id,
        startDate: new Date().toISOString().split("T")[0]!,
        seriesException: "different-time",
      });

      expect(result).toBeDefined();
      expect(result.seriesException).toBe("different-time");

      if (result.id) {
        createdEventInstanceIds.push(result.id);
      }
    });

    it("should update seriesException on existing event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        seriesException: "closed",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        seriesException: "miscellaneous",
      });

      expect(result.id).toBe(eventInstance.id);
      expect(result.seriesException).toBe("miscellaneous");
    });

    it("should create event instance with event type", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create an event type
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (eventType) {
        createdEventTypeIds.push(eventType.id);
      }

      if (!eventType) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        name: `Event With Type ${uniqueId()}`,
        orgId: ao.id,
        startDate: new Date().toISOString().split("T")[0]!,
        eventTypeId: eventType.id,
      });

      expect(result).toBeDefined();

      if (result.id) {
        createdEventInstanceIds.push(result.id);

        // Verify event type was linked
        const [linkRecord] = await db
          .select()
          .from(schema.eventInstancesXEventTypes)
          .where(
            eq(schema.eventInstancesXEventTypes.eventInstanceId, result.id),
          );

        expect(linkRecord).toBeDefined();
        expect(linkRecord?.eventTypeId).toBe(eventType.id);
      }
    });

    it("should require editor role", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create session without editor role for this AO
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
        client.eventInstance.crupdate({
          name: `Unauthorized Event ${uniqueId()}`,
          orgId: ao.id,
          startDate: new Date().toISOString().split("T")[0]!,
        }),
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("should delete event instance with admin role", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create session with admin role on the AO org
      const session = {
        id: 1,
        email: "admin@example.com",
        user: {
          id: "1",
          email: "admin@example.com",
          name: "Admin",
          roles: [
            {
              orgId: ao.id,
              orgName: ao.name ?? "Test AO",
              roleName: "admin" as const,
            },
          ],
        },
        roles: [
          {
            orgId: ao.id,
            orgName: ao.name ?? "Test AO",
            roleName: "admin" as const,
          },
        ],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
      await mockAuthWithSession(session);

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      // Keep in cleanup list since soft delete still leaves the record
      const client = createTestClient();
      const result = await client.eventInstance.delete({
        id: eventInstance.id,
      });

      expect(result.success).toBe(true);

      // Verify soft deletion (isActive = false)
      const [deleted] = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventInstance.id));

      expect(deleted?.isActive).toBe(false);
    });

    it("should throw NOT_FOUND for non-existent event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.eventInstance.delete({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("sorting", () => {
    it("should sort by start date ascending", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create events with different dates
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      await createTestEventInstance(ao.id, {
        startDate: tomorrow.toISOString().split("T")[0]!,
      });
      await createTestEventInstance(ao.id, {
        startDate: today.toISOString().split("T")[0]!,
      });

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        sorting: [{ id: "startDate", desc: false }],
        pageIndex: 0,
        pageSize: 10,
      });

      if (result.eventInstances.length >= 2) {
        const dates = result.eventInstances.map((e) => e.startDate);
        // Should be sorted ascending
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i]! >= dates[i - 1]!).toBe(true);
        }
      }
    });

    it("should sort by start date descending", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create events with different dates
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      await createTestEventInstance(ao.id, {
        startDate: today.toISOString().split("T")[0]!,
      });
      await createTestEventInstance(ao.id, {
        startDate: tomorrow.toISOString().split("T")[0]!,
      });

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        sorting: [{ id: "startDate", desc: true }],
        pageIndex: 0,
        pageSize: 10,
      });

      if (result.eventInstances.length >= 2) {
        const dates = result.eventInstances.map((e) => e.startDate);
        // Should be sorted descending
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i]! <= dates[i - 1]!).toBe(true);
        }
      }
    });
  });
});
