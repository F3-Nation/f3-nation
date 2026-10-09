/**
 * Tests for Event Router endpoints
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

import { eq, inArray, schema } from "@acme/db";
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

/** Returns the YYYY-MM-DD date string for the nth upcoming Monday (UTC). n=1 is next Monday. */
const nextFutureMonday = (n: number): string => {
  const d = new Date();
  const daysUntilNextMonday = (1 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilNextMonday + (n - 1) * 7);
  return d.toISOString().split("T")[0]!;
};

describe("Event Router", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdEventTagIds: number[] = [];
  const createdLocationIds: number[] = [];
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

  afterAll(
    async () => {
      // Clean up in reverse order, respecting FK constraints
      for (const eventId of createdEventIds.reverse()) {
        try {
          await cleanup.event(eventId);
        } catch {
          // Ignore errors during cleanup
        }
      }
      for (const userId of createdUserIds.reverse()) {
        try {
          await cleanup.user(userId);
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
      for (const eventTagId of createdEventTagIds.reverse()) {
        try {
          await db
            .delete(schema.eventTagsXEvents)
            .where(eq(schema.eventTagsXEvents.eventTagId, eventTagId));
          await db
            .delete(schema.eventTagsXEventInstances)
            .where(eq(schema.eventTagsXEventInstances.eventTagId, eventTagId));
          await db
            .delete(schema.eventTags)
            .where(eq(schema.eventTags.id, eventTagId));
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
    },
    30000, // 30 second timeout for cleanup
  );

  // Helper to create test region
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

  // Helper to create test AO
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

  // Helper to create test location
  const createTestLocation = async (orgId: number) => {
    const [location] = await db
      .insert(schema.locations)
      .values({
        name: `Test Location ${uniqueId()}`,
        orgId,
        isActive: true,
        latitude: 35.5,
        longitude: -80.5,
      })
      .returning();

    if (location) {
      createdLocationIds.push(location.id);
    }
    return location;
  };

  // Helper to create test event type
  const createTestEventType = async () => {
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
    return eventType;
  };

  const createTestEventTag = async () => {
    const [eventTag] = await db
      .insert(schema.eventTags)
      .values({ name: `Test Event Tag ${uniqueId()}`, isActive: true })
      .returning();
    if (eventTag) createdEventTagIds.push(eventTag.id);
    return eventTag;
  };

  const createScopedEventTag = async (
    specificOrgId: number,
    isActive = true,
  ) => {
    const [eventTag] = await db
      .insert(schema.eventTags)
      .values({
        name: `Scoped Event Tag ${uniqueId()}`,
        specificOrgId,
        isActive,
      })
      .returning();
    if (eventTag) createdEventTagIds.push(eventTag.id);
    return eventTag;
  };

  describe("all", () => {
    it("should include events without a location (locationId null)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create an event with no location
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `No Location Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.some((e) => e.id === created?.id)).toBe(true);
    });
  });

  describe("map.event.all", () => {
    it("should return a list of events with filtering", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const [created] = await db
        .insert(schema.events)
        .values({
          name: `MapFilterEvent ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.length).toBeGreaterThanOrEqual(1);
      expect(result.events?.length).toBeLessThanOrEqual(50);
    });

    it("should include events without a location (locationId null)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Map No Location Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        aoIds: [ao.id],
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      const rovingEvent = result.events?.find((e) => e.id === created?.id);
      expect(rovingEvent).toBeDefined();
      expect(rovingEvent?.locationId).toBeNull();
      expect(rovingEvent?.locationName).toBeNull();
      expect(rovingEvent?.location).toBeNull();
    });

    it("should return response shape without pre-existing data", async () => {
      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.length).toBeGreaterThan(0);
    });
  });

  describe("map.event.all pagination", () => {
    it("should return a list of events with filtering", async () => {
      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.map.event.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.map.event.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.events?.length).toBeLessThanOrEqual(2);
      expect(page2.events?.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 events
      if (
        page1.totalCount > 2 &&
        (page1.events?.length ?? 0) > 0 &&
        (page2.events?.length ?? 0) > 0
      ) {
        expect(page1.events?.[0]?.id).not.toBe(page2.events?.[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeEvents = await client.map.event.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeEvents.events?.every((e) => e.isActive === true)).toBe(true);
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event with unique name
      const uniqueName = `SearchableEvent ${uniqueId()}`;
      const [created] = await db
        .insert(schema.events)
        .values({
          name: uniqueName,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        searchTerm: "SearchableEvent",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created event
      const found = result.events?.some((e) => e.id === created?.id);
      expect(found).toBe(true);
    });

    it("should filter by region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event in this region
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Region Filter Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        regionIds: [region.id],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      // Our event should be in the results
      const found = result.events?.some((e) => e.id === created?.id);
      expect(found).toBe(true);
    });

    it("should return isPrivate field for events", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a public event
      const [publicEvent] = await db
        .insert(schema.events)
        .values({
          name: `Public Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (publicEvent) {
        createdEventIds.push(publicEvent.id);
      }

      // Create a private event
      const [privateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Private Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: true,
        })
        .returning();

      if (privateEvent) {
        createdEventIds.push(privateEvent.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 100,
      });

      // Find our events in the results
      const foundPublic = result.events?.find((e) => e.id === publicEvent?.id);
      const foundPrivate = result.events?.find(
        (e) => e.id === privateEvent?.id,
      );

      // Both events should have isPrivate field
      expect(foundPublic).toBeDefined();
      expect(foundPublic?.isPrivate).toBe(false);

      expect(foundPrivate).toBeDefined();
      expect(foundPrivate?.isPrivate).toBe(true);
    });

    it("should filter by eventTypeNames", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a unique event type
      const uniqueTypeName = `UniqueType ${uniqueId()}`;
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: uniqueTypeName,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      // Create an event with this event type
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Event Type Filter Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!created) return;
      createdEventIds.push(created.id);

      // Link event to event type
      await db.insert(schema.eventsXEventTypes).values({
        eventId: created.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      const result = await client.map.event.all({
        eventTypeNames: [uniqueTypeName],
        pageIndex: 0,
        pageSize: 100,
      });

      // Our event should be in the results
      const found = result.events?.some((e) => e.id === created.id);
      expect(found).toBe(true);

      // All returned events should have an eventType matching our filter
      result.events?.forEach((event) => {
        const hasMatchingType = event.eventTypes.some(
          (et) => et.eventTypeName === uniqueTypeName,
        );
        expect(hasMatchingType).toBe(true);
      });
    });

    it("should filter by eventCategories", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create event types for different categories
      const [thirdFType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Third F Type ${uniqueId()}`,
          eventCategory: "third_f",
          isActive: true,
        })
        .returning();

      if (!thirdFType) return;
      createdEventTypeIds.push(thirdFType.id);

      // Create an event with third_f category
      const [thirdFEvent] = await db
        .insert(schema.events)
        .values({
          name: `Third F Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "1800",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!thirdFEvent) return;
      createdEventIds.push(thirdFEvent.id);

      // Link event to event type
      await db.insert(schema.eventsXEventTypes).values({
        eventId: thirdFEvent.id,
        eventTypeId: thirdFType.id,
      });

      const client = createTestClient();
      const result = await client.map.event.all({
        eventCategories: ["third_f"],
        pageIndex: 0,
        pageSize: 100,
      });

      // Our third_f event should be in the results
      const found = result.events?.some((e) => e.id === thirdFEvent.id);
      expect(found).toBe(true);

      // All returned events should have third_f category
      result.events?.forEach((event) => {
        const hasThirdF = event.eventTypes.some(
          (et) => et.eventCategory === "third_f",
        );
        expect(hasThirdF).toBe(true);
      });
    });
  });

  describe("count", () => {
    it("should return a count of events", async () => {
      const client = createTestClient();
      const result = await client.event.count();

      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it("should return count matching status filter", async () => {
      const client = createTestClient();

      // Get count of active events
      const activeCount = await client.event.count({
        statuses: ["active"],
      });

      // Get count of inactive events
      const inactiveCount = await client.event.count({
        statuses: ["inactive"],
      });

      // Get count of all events (active + inactive)
      const allCount = await client.event.count({
        statuses: ["active", "inactive"],
      });

      expect(activeCount.count).toBeGreaterThanOrEqual(0);
      expect(inactiveCount.count).toBeGreaterThanOrEqual(0);
      // Active + inactive should approximately equal all
      // Note: Due to concurrent test execution, counts may vary slightly between queries
      const sum = activeCount.count + inactiveCount.count;
      expect(Math.abs(sum - allCount.count)).toBeLessThanOrEqual(2);
    });

    it("should return count matching eventTypeNames filter", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a unique event type
      const uniqueTypeName = `CountTestType ${uniqueId()}`;
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: uniqueTypeName,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      // Create events with this event type
      const eventsToCreate = 3;
      for (let i = 0; i < eventsToCreate; i++) {
        const [created] = await db
          .insert(schema.events)
          .values({
            name: `Count Test Event ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            isActive: true,
            highlight: false,
            startDate: "2026-01-01",
          })
          .returning();

        if (created) {
          createdEventIds.push(created.id);
          await db.insert(schema.eventsXEventTypes).values({
            eventId: created.id,
            eventTypeId: eventType.id,
          });
        }
      }

      const client = createTestClient();
      const result = await client.event.count({
        eventTypeNames: [uniqueTypeName],
      });

      // Should have at least the events we created
      expect(result.count).toBeGreaterThanOrEqual(eventsToCreate);
    });

    it("should return count matching eventCategories filter", async () => {
      const client = createTestClient();

      const result = await client.event.count({
        eventCategories: ["first_f"],
      });

      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it("should return count matching region filter", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event in this region
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Region Count Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.event.count({
        regionIds: [region.id],
      });

      // Should have at least 1 event in this region
      expect(result.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("byId", () => {
    it("should return an event by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a test event
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `ById Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0545",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      const client = createTestClient();
      const result = await client.event.byId({
        id: testEvent.id,
      });

      expect(result).toHaveProperty("event");
      expect(result.event).not.toBeNull();
      expect(result.event?.id).toBe(testEvent.id);
    });

    it("should return null for non-existent event", async () => {
      const client = createTestClient();
      const result = await client.event.byId({
        id: 999999,
      });

      expect(result.event).toBeNull();
    });

    it("should return isPrivate field for an event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a private event
      const [privateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Private ById Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0545",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: true,
        })
        .returning();

      if (!privateEvent) return;
      createdEventIds.push(privateEvent.id);

      const client = createTestClient();
      const result = await client.event.byId({
        id: privateEvent.id,
      });

      expect(result.event).not.toBeNull();
      expect(result.event?.id).toBe(privateEvent.id);
      expect(result.event?.isPrivate).toBe(true);
    });
  });

  describe("crupdate", () => {
    it("soft deletes future instances without recreating them on deactivation", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(region.id);
      if (!location) return;
      const eventType = await createTestEventType();
      const updatedEventType = await createTestEventType();
      if (!eventType || !updatedEventType) return;

      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const createSeries = async (name: string) => {
        const [series] = await db
          .insert(schema.events)
          .values({
            name,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2020-01-06",
            endDate: null,
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!series) throw new Error("Failed to create test series");
        createdEventIds.push(series.id);
        return series;
      };

      const insertInstance = async (
        seriesId: number,
        startDate: string,
        name: string,
      ) => {
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate,
            isActive: true,
            highlight: false,
            seriesId,
            isPrivate: false,
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        return instance;
      };

      const series = await createSeries(`Status Cascade ${uniqueId()}`);
      const pastInstance = await insertInstance(
        series.id,
        "2020-01-13",
        `Past instance ${uniqueId()}`,
      );
      const futureInstance = await insertInstance(
        series.id,
        nextFutureMonday(2),
        `Future instance ${uniqueId()}`,
      );
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureInstance.id,
        eventTypeId: eventType.id,
      });

      const unrelatedSeries = await createSeries(
        `Unrelated Series ${uniqueId()}`,
      );
      const unrelatedInstance = await insertInstance(
        unrelatedSeries.id,
        nextFutureMonday(3),
        `Unrelated instance ${uniqueId()}`,
      );

      const client = createTestClient();
      await client.event.crupdate({
        id: series.id,
        name: `${series.name} updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0545",
        endTime: "0630",
        // A simultaneous structural change must not route deactivation through
        // the hard-delete/recreate cascade.
        startDate: "2020-01-13",
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: false,
        eventTypeIds: [updatedEventType.id],
        email: null,
      });

      const persistedInstances = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(
          inArray(schema.eventInstances.id, [
            pastInstance.id,
            futureInstance.id,
            unrelatedInstance.id,
          ]),
        );
      expect(persistedInstances).toHaveLength(3);
      expect(persistedInstances).toContainEqual({
        id: pastInstance.id,
        isActive: true,
      });
      expect(persistedInstances).toContainEqual({
        id: futureInstance.id,
        isActive: false,
      });
      const [updatedFutureDetails] = await db
        .select({
          name: schema.eventInstances.name,
          locationId: schema.eventInstances.locationId,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, futureInstance.id));
      expect(updatedFutureDetails).toEqual({
        name: `${series.name} updated`,
        locationId: location.id,
        startTime: "0545",
        endTime: "0630",
      });
      expect(persistedInstances).toContainEqual({
        id: unrelatedInstance.id,
        isActive: true,
      });
      const futureInstanceTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            futureInstance.id,
          ),
        );
      expect(futureInstanceTypes).toEqual([
        { eventTypeId: updatedEventType.id },
      ]);
    });

    it("does not cascade on inactive no-op or active-to-active status saves", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const fixtures = [];
      for (const isActive of [false, true]) {
        const [series] = await db
          .insert(schema.events)
          .values({
            name: `Status No-op ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2020-01-06",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            isActive,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!series) throw new Error("Failed to create test series");
        createdEventIds.push(series.id);
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Status No-op instance ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: series.id,
            isPrivate: false,
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        fixtures.push({ series, instance });
      }

      const client = createTestClient();
      for (const { series } of fixtures) {
        await client.event.crupdate({
          id: series.id,
          name: series.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: series.startDate,
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: series.isActive,
          eventTypeIds: [eventType.id],
          email: null,
        });
      }

      const instanceStatuses = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(
          inArray(
            schema.eventInstances.id,
            fixtures.map(({ instance }) => instance.id),
          ),
        );
      expect(instanceStatuses).toHaveLength(2);
      expect(instanceStatuses.every(({ isActive }) => isActive)).toBe(true);
    });

    it("reactivates existing instances from today onward without changing history", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(region.id);
      if (!location) return;
      const eventType = await createTestEventType();
      const updatedEventType = await createTestEventType();
      const eventTag = await createTestEventTag();
      if (!eventType || !eventTag || !updatedEventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Reactivated Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) throw new Error("Failed to create test series");
      createdEventIds.push(series.id);
      const [attendanceUser] = await db
        .insert(schema.users)
        .values({
          email: `series-reactivation-${uniqueId()}@example.com`,
          f3Name: `Series Reactivation ${uniqueId()}`,
        })
        .returning();
      if (!attendanceUser) throw new Error("Failed to create test user");
      createdUserIds.push(attendanceUser.id);

      const today = new Date().toISOString().split("T")[0]!;
      const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      const yesterday = yesterdayDate.toISOString().split("T")[0]!;
      const createInstance = async (params: {
        seriesId: number;
        startDate: string;
        isActive: boolean;
        seriesException?: "closed" | null;
      }) => {
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Reactivation Instance ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate: params.startDate,
            isActive: params.isActive,
            highlight: false,
            seriesId: params.seriesId,
            isPrivate: false,
            seriesException: params.seriesException ?? null,
            paxCount: 7,
            preblast: "Existing preblast",
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        return instance;
      };

      const past = await createInstance({
        seriesId: series.id,
        startDate: yesterday,
        isActive: false,
      });
      const todayInactive = await createInstance({
        seriesId: series.id,
        startDate: today,
        isActive: false,
        seriesException: "closed",
      });
      const futureInactive = await createInstance({
        seriesId: series.id,
        startDate: nextFutureMonday(2),
        isActive: false,
        seriesException: "closed",
      });
      const futureActive = await createInstance({
        seriesId: series.id,
        startDate: nextFutureMonday(3),
        isActive: true,
      });
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureInactive.id,
        eventTypeId: eventType.id,
      });
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureActive.id,
        eventTypeId: eventType.id,
      });
      await db.insert(schema.eventTagsXEventInstances).values({
        eventInstanceId: futureInactive.id,
        eventTagId: eventTag.id,
      });
      await db.insert(schema.attendance).values({
        userId: attendanceUser.id,
        eventInstanceId: futureInactive.id,
        isPlanned: false,
      });

      const [otherSeries] = await db
        .insert(schema.events)
        .values({
          name: `Unrelated Inactive Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!otherSeries) throw new Error("Failed to create unrelated series");
      createdEventIds.push(otherSeries.id);
      const otherInstance = await createInstance({
        seriesId: otherSeries.id,
        startDate: nextFutureMonday(4),
        isActive: false,
      });

      const client = createTestClient();
      await client.event.crupdate({
        id: series.id,
        name: `${series.name} updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0545",
        endTime: "0630",
        // Structural schedule edit exercises status-transition precedence.
        startDate: "2020-01-13",
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [updatedEventType.id],
        email: null,
      });

      const observed = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
          name: schema.eventInstances.name,
          locationId: schema.eventInstances.locationId,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
          seriesException: schema.eventInstances.seriesException,
          paxCount: schema.eventInstances.paxCount,
          preblast: schema.eventInstances.preblast,
        })
        .from(schema.eventInstances)
        .where(
          inArray(schema.eventInstances.id, [
            past.id,
            todayInactive.id,
            futureInactive.id,
            futureActive.id,
            otherInstance.id,
          ]),
        );
      expect(observed).toHaveLength(5);
      const seriesInstanceIds = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));
      expect(seriesInstanceIds.map(({ id }) => id).sort()).toEqual(
        [past.id, todayInactive.id, futureInactive.id, futureActive.id].sort(),
      );
      const byId = new Map(observed.map((instance) => [instance.id, instance]));
      expect(byId.get(past.id)).toMatchObject({
        id: past.id,
        isActive: false,
        seriesException: null,
      });
      expect(byId.get(todayInactive.id)).toMatchObject({
        id: todayInactive.id,
        isActive: true,
        seriesException: "closed",
        paxCount: 7,
        preblast: "Existing preblast",
      });
      expect(byId.get(futureInactive.id)).toMatchObject({
        id: futureInactive.id,
        isActive: true,
        name: `${series.name} updated`,
        locationId: location.id,
        startTime: "0545",
        endTime: "0630",
        seriesException: "closed",
        paxCount: 7,
        preblast: "Existing preblast",
      });
      expect(byId.get(futureActive.id)).toMatchObject({
        id: futureActive.id,
        isActive: true,
      });
      expect(byId.get(otherInstance.id)).toMatchObject({
        id: otherInstance.id,
        isActive: false,
      });

      const retainedEventTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            futureInactive.id,
          ),
        );
      const retainedTags = await db
        .select({ eventTagId: schema.eventTagsXEventInstances.eventTagId })
        .from(schema.eventTagsXEventInstances)
        .where(
          eq(
            schema.eventTagsXEventInstances.eventInstanceId,
            futureInactive.id,
          ),
        );
      expect(retainedEventTypes).toEqual([{ eventTypeId: eventType.id }]);
      const updatedOpenInstanceTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(schema.eventInstancesXEventTypes.eventInstanceId, futureActive.id),
        );
      expect(updatedOpenInstanceTypes).toEqual([
        { eventTypeId: updatedEventType.id },
      ]);
      expect(retainedTags).toEqual([{ eventTagId: eventTag.id }]);
      const retainedAttendance = await db
        .select({ userId: schema.attendance.userId })
        .from(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, futureInactive.id));
      expect(retainedAttendance).toEqual([{ userId: attendanceUser.id }]);
    });

    it("preserves omitted metadata on reactivation and allows explicit metadata clearing", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const seriesMeta = { seriesKey: "series-value" };
      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Metadata reactivation ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
          meta: seriesMeta,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      await db.insert(schema.eventsXEventTypes).values({
        eventId: series.id,
        eventTypeId: eventType.id,
      });
      const instanceMeta = { instanceOverride: "keep-me" };
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: series.name,
          orgId: ao.id,
          locationId: null,
          startTime: series.startTime,
          endTime: series.endTime,
          startDate: nextFutureMonday(2),
          isActive: false,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
          meta: instanceMeta,
        })
        .returning();
      if (!instance) return;
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: instance.id,
        eventTypeId: eventType.id,
      });

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const [persistedSeries] = await db
        .select({ meta: schema.events.meta })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [persistedInstance] = await db
        .select({
          isActive: schema.eventInstances.isActive,
          meta: schema.eventInstances.meta,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(persistedSeries?.meta).toEqual(seriesMeta);
      expect(persistedInstance).toEqual({ isActive: true, meta: instanceMeta });

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        meta: null,
        email: null,
      });

      const [clearedSeries] = await db
        .select({ meta: schema.events.meta })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [clearedInstance] = await db
        .select({ meta: schema.eventInstances.meta })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(clearedSeries?.meta).toBeNull();
      expect(clearedInstance?.meta).toBeNull();
    });

    it("requires admin permission to deactivate an existing event", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Editor Deactivation ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Editor Deactivation Instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: true,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) return;

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const error = await createTestClient()
        .event.crupdate({
          id: series.id,
          name: `Mutated ${series.name}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-13",
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: false,
          eventTypeIds: [eventType.id],
          email: null,
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toMatchObject({ code: "UNAUTHORIZED" });
      const [unchangedSeries] = await db
        .select({
          name: schema.events.name,
          startDate: schema.events.startDate,
          isActive: schema.events.isActive,
        })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [unchangedInstance] = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(unchangedSeries).toEqual({
        name: series.name,
        startDate: series.startDate,
        isActive: true,
      });
      expect(unchangedInstance).toEqual({ id: instance.id, isActive: true });
    });

    it("does not reactivate an obsolete schedule when a series becomes a one-off", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `One-off conversion ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [obsoleteInstance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Obsolete schedule instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: false,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!obsoleteInstance) return;

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const instances = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));
      expect(instances).toEqual([{ id: obsoleteInstance.id, isActive: false }]);
    });

    it("deactivates existing future instances when an active series becomes a one-off", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Active series conversion ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Active future instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: true,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) return;

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: false,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const [persisted] = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(persisted).toEqual({ id: instance.id, isActive: false });
    });

    it("creates instances when an inactive one-off becomes an active series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Inactive one-off conversion ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: null,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);

      await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, event.id));
      expect(instances.length).toBeGreaterThan(0);
    });

    it("should create a new event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Give the session editor permission on the AO
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const eventName = `Test Event ${uniqueId()}`;

      const result = await client.event.crupdate({
        name: eventName,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "thursday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result).toHaveProperty("event");
      expect(result.event).not.toBeNull();
      expect(result.event?.name).toBe(eventName);

      if (result.event) {
        createdEventIds.push(result.event.id);
      }
    });

    it("should persist event tags and expose them in event reads", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tags = [await createTestEventTag(), await createTestEventTag()];
      const eventType = await createTestEventType();
      if (!tags[0] || !tags[1] || !eventType) return;
      const tagIds = [tags[0].id, tags[1].id];
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const client = createTestClient();
      const created = await client.event.crupdate({
        name: `Tagged Series ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [tagIds[0]!, tagIds[1]!, tagIds[0]!],
        email: null,
      });
      if (!created.event) return;
      createdEventIds.push(created.event.id);
      const detail = await client.event.byId({ id: created.event.id });
      expect(detail.event?.eventTagIds.sort()).toEqual(tagIds.sort());
      const list = await client.event.all({
        aoIds: [ao.id],
        pageIndex: 0,
        pageSize: 100,
      });
      expect(
        list.events
          .find((event) => event.id === created.event!.id)
          ?.eventTagIds.sort(),
      ).toEqual(tagIds.sort());
    });

    it("should clear series and future instance tags when explicitly cleared", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      const eventType = await createTestEventType();
      if (!tag || !eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const client = createTestClient();
      const startDate = nextFutureMonday(1);
      const endDate = nextFutureMonday(4);
      const created = await client.event.crupdate({
        name: `Clear Tagged Series ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate,
        endDate,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [tag.id],
        email: null,
      });
      if (!created.event) return;
      createdEventIds.push(created.event.id);

      const instancesBefore = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, created.event.id));
      expect(instancesBefore.length).toBeGreaterThan(0);

      await client.event.crupdate({
        id: created.event.id,
        name: created.event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate,
        endDate,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [],
        email: null,
      });

      const eventTags = await db
        .select()
        .from(schema.eventTagsXEvents)
        .where(eq(schema.eventTagsXEvents.eventId, created.event.id));
      const instanceTags = await db
        .select()
        .from(schema.eventTagsXEventInstances)
        .where(
          inArray(
            schema.eventTagsXEventInstances.eventInstanceId,
            instancesBefore.map((instance) => instance.id),
          ),
        );
      expect(eventTags).toEqual([]);
      expect(instanceTags).toEqual([]);
    });

    it("should preserve non-recurring event tags when omitted", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      const eventType = await createTestEventType();
      if (!tag || !eventType) return;
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Tagged Nonrecurring ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startDate: nextFutureMonday(1),
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);
      await db.insert(schema.eventTagsXEvents).values({
        eventId: event.id,
        eventTagId: tag.id,
      });
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      await createTestClient().event.crupdate({
        id: event.id,
        name: `${event.name} Updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const tags = await db
        .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
        .from(schema.eventTagsXEvents)
        .where(eq(schema.eventTagsXEvents.eventId, event.id));
      expect(tags).toEqual([{ eventTagId: tag.id }]);
    });

    it.each([
      ["nonexistent", 999999999],
      ["inactive", "inactive"],
      ["cross-region", "cross-region"],
    ])(
      "should reject %s tags without partial event mutations",
      async (_label, tagCase) => {
        const region = await createTestRegion();
        if (!region) return;
        const ao = await createTestAO(region.id);
        if (!ao) return;
        const otherRegion = await createTestRegion();
        if (!otherRegion) return;
        const tag = await createTestEventTag();
        const parentRegionTag = await createScopedEventTag(region.id);
        const inactiveTag = await createScopedEventTag(ao.id, false);
        const crossRegionTag = await createScopedEventTag(otherRegion.id);
        const eventType = await createTestEventType();
        if (
          !tag ||
          !parentRegionTag ||
          !inactiveTag ||
          !crossRegionTag ||
          !eventType
        )
          return;
        const [event] = await db
          .insert(schema.events)
          .values({
            name: `Invalid Tag Event ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: null,
            startDate: nextFutureMonday(1),
            isActive: true,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!event) return;
        createdEventIds.push(event.id);
        await db.insert(schema.eventTagsXEvents).values({
          eventId: event.id,
          eventTagId: tag.id,
        });
        await mockAuthWithSession(
          createEditorSession({ orgId: ao.id, orgName: ao.name }),
        );

        const invalidTagId =
          typeof tagCase === "number"
            ? tagCase
            : tagCase === "inactive"
              ? inactiveTag.id
              : crossRegionTag.id;
        const error = await createTestClient()
          .event.crupdate({
            id: event.id,
            name: `${event.name} Mutated?`,
            aoId: ao.id,
            regionId: region.id,
            locationId: null,
            dayOfWeek: null,
            startTime: "0530",
            endTime: "0615",
            startDate: event.startDate,
            endDate: null,
            recurrencePattern: null,
            recurrenceInterval: null,
            indexWithinInterval: null,
            highlight: false,
            isActive: true,
            eventTypeIds: [eventType.id],
            eventTagIds: [invalidTagId],
            email: null,
          })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );
        expect(error).toMatchObject({ code: "BAD_REQUEST" });

        const [unchanged] = await db
          .select({ name: schema.events.name })
          .from(schema.events)
          .where(eq(schema.events.id, event.id));
        const associations = await db
          .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
          .from(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventId, event.id));
        expect(unchanged?.name).toBe(event.name);
        expect(associations).toEqual([{ eventTagId: tag.id }]);
      },
    );

    it("should accept nationwide and direct parent-region tags", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const nationwideTag = await createTestEventTag();
      const parentRegionTag = await createScopedEventTag(region.id);
      const eventType = await createTestEventType();
      if (!nationwideTag || !parentRegionTag || !eventType) return;

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const result = await createTestClient().event.crupdate({
        name: `Valid Scoped Tags ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: nextFutureMonday(1),
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [nationwideTag.id, parentRegionTag.id],
        email: null,
      });
      if (result.event) {
        createdEventIds.push(result.event.id);
        const tags = await db
          .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
          .from(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventId, result.event.id));
        expect(tags.map(({ eventTagId }) => eventTagId).sort()).toEqual(
          [nationwideTag.id, parentRegionTag.id].sort(),
        );
      }
    });

    it("should carry existing event tags onto instances when starting a series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      if (!tag) return;
      const eventType = await createTestEventType();
      if (!eventType) return;

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Converted Tagged Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startDate: nextFutureMonday(1),
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);
      await db.insert(schema.eventTagsXEvents).values({
        eventId: event.id,
        eventTagId: tag.id,
      });

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const result = await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result.event?.id).toBe(event.id);
      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, event.id));
      expect(instances.length).toBeGreaterThan(0);

      const tags = await db
        .select({ eventTagId: schema.eventTagsXEventInstances.eventTagId })
        .from(schema.eventTagsXEventInstances)
        .where(
          inArray(
            schema.eventTagsXEventInstances.eventInstanceId,
            instances.map((instance) => instance.id),
          ),
        );
      expect(tags).toHaveLength(instances.length);
      expect(tags.every(({ eventTagId }) => eventTagId === tag.id)).toBe(true);
    });

    it("should require all mandatory fields", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Missing required fields should fail validation
      await expect(
        client.event.crupdate({
          name: "Incomplete Event",
          locationId: 1,
          dayOfWeek: "friday",
          startTime: "0600",
          isActive: true,
        } as Parameters<typeof client.event.crupdate>[0]),
      ).rejects.toThrow();
    });

    it("should update an existing event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Create an event first
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Original Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "friday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Give the session editor permission on the AO
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const updatedName = `Updated Event ${uniqueId()}`;

      const result = await client.event.crupdate({
        id: testEvent.id,
        name: updatedName,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "saturday",
        startTime: "0700",
        endTime: "0800",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result.event?.id).toBe(testEvent.id);
      expect(result.event?.name).toBe(updatedName);
    });

    it("should enforce editor permissions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Create a session with no permission on this AO
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.event.crupdate({
          name: "Unauthorized Event",
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "sunday",
          startTime: "0800",
          endTime: "0900",
          startDate: "2026-01-01",
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        }),
      ).rejects.toThrow();
    });

    describe("destination org", () => {
      const setup = async () => {
        await mockAuthWithSession(await createAdminSession());
        const regionA = await createTestRegion();
        const regionB = await createTestRegion();
        if (!regionA || !regionB) throw new Error("Failed to create regions");
        const aoA = await createTestAO(regionA.id);
        const aoB = await createTestAO(regionB.id);
        const locationA = await createTestLocation(regionA.id);
        const locationB = await createTestLocation(regionB.id);
        const eventType = await createTestEventType();
        if (!aoA || !aoB || !locationA || !locationB || !eventType) {
          throw new Error("Failed to create fixtures");
        }
        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        const input = {
          name: `Scoped Event ${uniqueId()}`,
          aoId: aoA.id,
          regionId: regionA.id,
          locationId: locationA.id,
          dayOfWeek: "monday" as const,
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        };
        return {
          regionA,
          regionB,
          aoA,
          aoB,
          locationA,
          locationB,
          eventType,
          input,
        };
      };

      const editorOfBoth = (
        a: { id: number; name: string },
        b: { id: number; name: string },
      ) => {
        const session = createEditorSession({ orgId: a.id, orgName: a.name });
        return {
          ...session,
          roles: [
            ...session.roles!,
            { orgId: b.id, orgName: b.name, roleName: "editor" as const },
          ],
        };
      };

      const insertTypeSpecificTo = async (orgId: number) => {
        const [type] = await db
          .insert(schema.eventTypes)
          .values({
            name: `Scoped Type ${uniqueId()}`,
            eventCategory: "first_f",
            specificOrgId: orgId,
            isActive: true,
          })
          .returning();
        if (!type) throw new Error("Failed to create event type");
        createdEventTypeIds.push(type.id);
        return type;
      };

      const readEvent = async (id: number) => {
        const [stored] = await db
          .select()
          .from(schema.events)
          .where(eq(schema.events.id, id));
        return stored;
      };

      const findByName = async (name: string) =>
        db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.name, name));

      it("updates an event within its own AO", async () => {
        const { input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        const { event: updated } = await client.event.crupdate({
          ...input,
          id: event.id,
          name: `${input.name} renamed`,
        });

        expect(updated?.name).toBe(`${input.name} renamed`);
      });

      it("rejects creating an event in another region's AO", async () => {
        const { regionB, aoB, input } = await setup();

        await expect(
          createTestClient().event.crupdate({
            ...input,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect(await findByName(input.name)).toEqual([]);
      });

      it("rejects pulling another region's event into the caller's AO", async () => {
        const { regionA, regionB, aoA, aoB, input } = await setup();
        await mockAuthWithSession(
          createEditorSession({ orgId: regionB.id, orgName: regionB.name }),
        );
        const client = createTestClient();
        const { event } = await client.event.crupdate({
          ...input,
          aoId: aoB.id,
          regionId: regionB.id,
          locationId: null,
        });
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoA.id,
            regionId: regionA.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect((await readEvent(event.id))?.orgId).toBe(aoB.id);
      });

      it("rejects moving an event into another region's AO", async () => {
        const { regionB, aoA, aoB, input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

        const [stored] = await db
          .select({ orgId: schema.events.orgId })
          .from(schema.events)
          .where(eq(schema.events.id, event.id));
        expect(stored?.orgId).toBe(aoA.id);
      });

      it("rejects a location from another region", async () => {
        const { locationB, input } = await setup();

        await expect(
          createTestClient().event.crupdate({
            ...input,
            locationId: locationB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(await findByName(input.name)).toEqual([]);
      });

      it("rejects an event type specific to another region", async () => {
        const { regionB, input } = await setup();
        const [otherType] = await db
          .insert(schema.eventTypes)
          .values({
            name: `Other Region Type ${uniqueId()}`,
            eventCategory: "first_f",
            specificOrgId: regionB.id,
            isActive: true,
          })
          .returning();
        if (!otherType) throw new Error("Failed to create event type");
        createdEventTypeIds.push(otherType.id);

        await expect(
          createTestClient().event.crupdate({
            ...input,
            eventTypeIds: [otherType.id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(await findByName(input.name)).toEqual([]);
      });
      it("rejects adding another region's event type on update", async () => {
        const { regionB, eventType, input } = await setup();
        const otherType = await insertTypeSpecificTo(regionB.id);
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            eventTypeIds: [eventType.id, otherType.id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        const linked = await db
          .select({ id: schema.eventsXEventTypes.eventTypeId })
          .from(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, event.id));
        expect(linked.map(({ id }) => id)).toEqual([eventType.id]);
      });

      it("rejects switching to another region's location on update", async () => {
        const { locationA, locationB, input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            locationId: locationB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readEvent(event.id))?.locationId).toBe(locationA.id);
      });

      it("re-checks existing links when moving an event", async () => {
        const { regionA, regionB, aoA, aoB, input } = await setup();
        await mockAuthWithSession(editorOfBoth(regionA, regionB));
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readEvent(event.id))?.orgId).toBe(aoA.id);
      });

      it("moves an event when the caller edits both regions", async () => {
        const { regionA, regionB, aoB, locationB, input } = await setup();
        await mockAuthWithSession(editorOfBoth(regionA, regionB));
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await client.event.crupdate({
          ...input,
          id: event.id,
          aoId: aoB.id,
          regionId: regionB.id,
          locationId: locationB.id,
        });
        expect((await readEvent(event.id))?.orgId).toBe(aoB.id);
      });

      it("lets legacy out-of-region links through on unrelated edits", async () => {
        const { regionB, eventType, input } = await setup();
        const legacyType = await insertTypeSpecificTo(regionB.id);
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);
        await db
          .insert(schema.eventsXEventTypes)
          .values({ eventId: event.id, eventTypeId: legacyType.id });

        await client.event.crupdate({
          ...input,
          id: event.id,
          name: `${input.name} renamed`,
          eventTypeIds: [eventType.id, legacyType.id],
        });
        expect((await readEvent(event.id))?.name).toBe(`${input.name} renamed`);
      });

      it("accepts a location owned by another AO in the same region", async () => {
        const { regionA, aoA, input } = await setup();
        await mockAuthWithSession(await createAdminSession());
        const siblingAo = await createTestAO(regionA.id);
        if (!siblingAo) throw new Error("Failed to create AO");
        const siblingLocation = await createTestLocation(siblingAo.id);
        const aoLocation = await createTestLocation(aoA.id);
        if (!siblingLocation || !aoLocation) {
          throw new Error("Failed to create locations");
        }
        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        const client = createTestClient();

        const { event } = await client.event.crupdate({
          ...input,
          locationId: siblingLocation.id,
        });
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);
        expect((await readEvent(event.id))?.locationId).toBe(
          siblingLocation.id,
        );

        const { event: moved } = await client.event.crupdate({
          ...input,
          id: event.id,
          aoId: siblingAo.id,
          locationId: aoLocation.id,
        });
        expect(moved?.id).toBe(event.id);
        expect((await readEvent(event.id))?.orgId).toBe(siblingAo.id);
      });
    });

    /**
     * `endDate` decides whether an event still counts as current in the map
     * queries and bounds the series instance cascade, so an inverted range must
     * be rejected server-side — the admin UI's client guard is bypassable.
     */
    describe("start/end date ordering", () => {
      /** Builds the org/location/event-type graph plus an editor session. */
      const setupCrupdateFixture = async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create test AO");

        const location = await createTestLocation(region.id);
        if (!location) throw new Error("Failed to create test location");

        const eventType = await createTestEventType();
        if (!eventType) throw new Error("Failed to create test event type");

        await mockAuthWithSession(
          createEditorSession({ orgId: ao.id, orgName: ao.name }),
        );

        return {
          client: createTestClient(),
          payload: {
            name: `Date Order Event ${uniqueId()}`,
            aoId: ao.id,
            regionId: region.id,
            locationId: location.id,
            dayOfWeek: "monday" as const,
            startTime: "0530",
            endTime: "0615",
            highlight: false,
            isActive: true,
            eventTypeIds: [eventType.id],
            email: null,
          },
        };
      };

      it("should reject an endDate before the startDate", async () => {
        const { client, payload } = await setupCrupdateFixture();

        await expect(
          client.event.crupdate({
            ...payload,
            startDate: "2026-02-01",
            endDate: "2026-01-31",
          }),
        ).rejects.toThrow();

        // Nothing may be persisted when the range is invalid.
        const persisted = await db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.name, payload.name));
        expect(persisted).toHaveLength(0);
      });

      it("should report the rejection against the endDate field", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const error = await client.event
          .crupdate({
            ...payload,
            startDate: "2026-02-01",
            endDate: "2026-01-01",
          })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );

        // Input validation failures surface as BAD_REQUEST, not a 500.
        expect(error).toMatchObject({ code: "BAD_REQUEST" });
        const issues =
          (
            error as {
              data?: { issues?: { path?: unknown[]; message?: string }[] };
            }
          ).data?.issues ?? [];
        // Pathed at endDate so the admin form can attach the message to that
        // field rather than showing a form-level error.
        expect(issues).toContainEqual(
          expect.objectContaining({
            path: ["endDate"],
            message: "End date must be on or after start date",
          }),
        );
      });

      it("should accept an endDate equal to the startDate (single-day event)", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-02-01",
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.startDate).toBe("2026-02-01");
        expect(result.event?.endDate).toBe("2026-02-01");
      });

      it("should accept an endDate after the startDate", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-03-01",
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.endDate).toBe("2026-03-01");
      });

      it("should accept a null endDate (open-ended series)", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: null,
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.endDate).toBeNull();
      });

      it("should reject an inverted range when updating an existing event", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const created = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-03-01",
        });
        const eventId = created.event?.id;
        if (!eventId) throw new Error("Failed to create event");
        createdEventIds.push(eventId);

        await expect(
          client.event.crupdate({
            ...payload,
            id: eventId,
            startDate: "2026-02-01",
            endDate: "2026-01-01",
          }),
        ).rejects.toThrow();

        // The stored row must keep its valid range.
        const [unchanged] = await db
          .select({ endDate: schema.events.endDate })
          .from(schema.events)
          .where(eq(schema.events.id, eventId));
        expect(unchanged?.endDate).toBe("2026-03-01");
      });
    });
  });

  describe("delete", () => {
    it("should soft delete an event (mark as inactive)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event to delete
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Delete Test Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Give the session admin permission on the AO
      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const client = createTestClient();

      const result = await client.event.delete({
        id: testEvent.id,
      });

      expect(result.eventId).toBe(testEvent.id);

      // Verify it's marked as inactive
      const [deletedEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, testEvent.id));

      expect(deletedEvent?.isActive).toBe(false);
    });

    it("should require admin permission to delete", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Delete Auth Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Create a session with only editor permission (not admin)
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await expect(
        client.event.delete({
          id: testEvent.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("eventIdToRegionNameLookup", () => {
    it("should return a lookup map of event IDs to region names", async () => {
      const client = createTestClient();
      const result = await client.event.eventIdToRegionNameLookup();

      expect(result).toHaveProperty("lookup");
      expect(typeof result.lookup).toBe("object");
    });
  });
  describe("cascade service integration", () => {
    describe("crupdate with recurrence", () => {
      it("should create event instances when creating a new recurring series", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();
        const seriesName = `Recurring Series ${uniqueId()}`;

        const result = await client.event.crupdate({
          name: seriesName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event).not.toBeNull();
        expect(result.event?.recurrencePattern).toBe("weekly");

        const seriesId = result.event?.id;
        if (seriesId) {
          createdEventIds.push(seriesId);

          // Verify instances were created
          const instances = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.seriesId, seriesId));

          expect(instances.length).toBeGreaterThan(0);
          // Should have instances for each Monday from Jan 1 to March 31, 2026
          expect(instances.length).toBeGreaterThanOrEqual(12);
          // Instances in eventInstances are cascade-deleted with the parent series event
        }
      });

      it("should update future instances in place for non-structural changes", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        // Create initial series
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Original Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2026-01-01",
            endDate: "2026-03-31",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);
        // Create some instances
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Original Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();
        const updatedName = `Updated Series ${uniqueId()}`;

        // Non-structural change: update name and time (not dayOfWeek, recurrence pattern, etc.)
        const result = await client.event.crupdate({
          id: seriesEvent.id,
          name: updatedName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "monday", // Same
          startTime: "0600", // Changed (non-structural)
          endTime: "0645", // Changed (non-structural)
          startDate: "2026-01-01", // Same
          endDate: "2026-03-31", // Same
          recurrencePattern: "weekly", // Same
          recurrenceInterval: 1, // Same
          indexWithinInterval: null, // Same
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event?.name).toBe(updatedName);
        expect(result.event?.startTime).toBe("0600");

        // Verify instance was updated in place (not recreated with new ID)
        if (instance1) {
          const [updatedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(updatedInstance?.name).toBe(updatedName);
          expect(updatedInstance?.startTime).toBe("0600");
          expect(updatedInstance?.seriesId).toBe(seriesEvent.id);
        }
      });

      it("should recreate future instances for structural changes", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const eventTag = await createTestEventTag();
        if (!eventTag) return;

        // Use dynamic dates so the series is always active relative to today
        const seriesStartDate = nextFutureMonday(1);
        const seriesEndDate = nextFutureMonday(12);

        // Create initial series on Mondays
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Structural Change Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: seriesStartDate,
            endDate: seriesEndDate,
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);
        await db.insert(schema.eventTagsXEvents).values({
          eventId: seriesEvent.id,
          eventTagId: eventTag.id,
        });

        // Create initial instance on Monday
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Structural Change Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Structural change: change dayOfWeek from Monday to Tuesday
        const result = await client.event.crupdate({
          id: seriesEvent.id,
          name: seriesEvent.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "tuesday", // Changed from Monday (structural)
          startTime: "0530",
          endTime: "0615",
          startDate: seriesStartDate,
          endDate: seriesEndDate,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event?.dayOfWeek).toBe("tuesday");

        // Verify old instance was hard-deleted (recreateFutureInstances deletes and recreates)
        if (instance1) {
          const [deletedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(deletedInstance).toBeUndefined();
        }

        // Verify new instances were created for Tuesdays
        const newInstances = await db
          .select()
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesEvent.id));

        expect(newInstances.length).toBeGreaterThan(0);
        const recreatedInstanceIds = newInstances.map(
          (instance) => instance.id,
        );
        const recreatedTags = await db
          .select()
          .from(schema.eventTagsXEventInstances)
          .where(
            inArray(
              schema.eventTagsXEventInstances.eventInstanceId,
              recreatedInstanceIds,
            ),
          );
        expect(
          recreatedTags.every((tag) => tag.eventTagId === eventTag.id),
        ).toBe(true);
        expect(recreatedTags).toHaveLength(recreatedInstanceIds.length);
        for (const instanceId of recreatedInstanceIds) {
          expect(
            recreatedTags.filter((tag) => tag.eventInstanceId === instanceId),
          ).toHaveLength(1);
        }
      });

      it("should create weekly instances when recurrencePattern is null (defaults to weekly)", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Create event with null recurrencePattern — should default to weekly
        const result = await client.event.crupdate({
          name: `Null Recurrence Weekly ${uniqueId()}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event).not.toBeNull();
        expect(result.event?.recurrencePattern).toBeNull();

        if (result.event) {
          createdEventIds.push(result.event.id);

          // Should still have weekly instances generated
          const instances = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.seriesId, result.event.id));

          expect(instances.length).toBeGreaterThan(0);
          // ~12 Wednesdays from Jan 1 to March 31
          expect(instances.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("should update instances in place (not duplicate) when updating a series with null recurrencePattern", async () => {
        // Regression test: a series with dayOfWeek set but recurrencePattern = null was
        // incorrectly treated as a non-series event on update, causing createEventInstancesForSeries
        // to run again and duplicate all existing instances.
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Step 1: Create a series with dayOfWeek set and recurrencePattern: null (defaults to weekly)
        const createResult = await client.event.crupdate({
          name: `Null Recurrence Regression ${uniqueId()}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "thursday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2027-01-01",
          endDate: "2027-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(createResult.event).not.toBeNull();
        const seriesId = createResult.event!.id;
        createdEventIds.push(seriesId);

        // Step 2: Record the unique instance dates after creation
        const instancesAfterCreate = await db
          .select({
            id: schema.eventInstances.id,
            startDate: schema.eventInstances.startDate,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesId));

        expect(instancesAfterCreate.length).toBeGreaterThan(0);
        const datesAfterCreate = instancesAfterCreate
          .map((i) => i.startDate)
          .sort();

        // Step 3: Update a non-structural field (name) — recurrencePattern stays null
        const updatedName = `Null Recurrence Regression Updated ${uniqueId()}`;
        const updateResult = await client.event.crupdate({
          id: seriesId,
          name: updatedName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "thursday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2027-01-01",
          endDate: "2027-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(updateResult.event?.name).toBe(updatedName);

        // Step 4: Assert no duplicate instances were created
        const instancesAfterUpdate = await db
          .select({
            id: schema.eventInstances.id,
            startDate: schema.eventInstances.startDate,
            name: schema.eventInstances.name,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesId));

        const datesAfterUpdate = instancesAfterUpdate
          .map((i) => i.startDate)
          .sort();

        // Instance count must not increase
        expect(instancesAfterUpdate.length).toBe(instancesAfterCreate.length);

        // Dates must be identical (no duplicates, no new entries)
        expect(datesAfterUpdate).toEqual(datesAfterCreate);

        // Instances should reflect the updated name
        expect(instancesAfterUpdate.every((i) => i.name === updatedName)).toBe(
          true,
        );
      });

      it("should cascade soft-delete to instances when deleting a series", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        // Create initial recurring series
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Delete Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2026-01-01",
            endDate: "2026-03-31",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);

        // Create instances
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Delete Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const adminSession = await createAdminSession();
        if (adminSession.roles && adminSession.user?.roles) {
          adminSession.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
          adminSession.user.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
        }
        await mockAuthWithSession(adminSession);

        const client = createTestClient();

        const result = await client.event.delete({
          id: seriesEvent.id,
        });

        expect(result.eventId).toBe(seriesEvent.id);

        // Verify series is soft-deleted
        const [deletedSeries] = await db
          .select()
          .from(schema.events)
          .where(eq(schema.events.id, seriesEvent.id));

        expect(deletedSeries?.isActive).toBe(false);

        // Verify instances are soft-deleted
        if (instance1) {
          const [deletedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(deletedInstance?.isActive).toBe(false);
        }
      });
    });
  });
});
