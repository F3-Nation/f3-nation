/**
 * Tests for Event Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Event Router", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdOrgIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up in reverse order, respecting FK constraints
    for (const eventId of createdEventIds.reverse()) {
      try {
        await cleanup.event(eventId);
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
  });

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

  describe("all", () => {
    it("should return a list of events", async () => {
      const client = createTestClient();
      const result = await client.event.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.event.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.event.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.events.length).toBeLessThanOrEqual(2);
      expect(page2.events.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 events
      if (
        page1.totalCount > 2 &&
        page1.events.length > 0 &&
        page2.events.length > 0
      ) {
        expect(page1.events[0]?.id).not.toBe(page2.events[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeEvents = await client.event.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeEvents.events.every((e) => e.isActive === true)).toBe(true);
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
      const result = await client.event.all({
        searchTerm: "SearchableEvent",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created event
      const found = result.events.some((e) => e.id === created?.id);
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
      const result = await client.event.all({
        regionIds: [region.id],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      // Our event should be in the results
      const found = result.events.some((e) => e.id === created?.id);
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
      const result = await client.event.all({
        pageIndex: 0,
        pageSize: 100,
      });

      // Find our events in the results
      const foundPublic = result.events.find((e) => e.id === publicEvent?.id);
      const foundPrivate = result.events.find((e) => e.id === privateEvent?.id);

      // Both events should have isPrivate field
      expect(foundPublic).toBeDefined();
      expect(foundPublic?.isPrivate).toBe(false);

      expect(foundPrivate).toBeDefined();
      expect(foundPrivate?.isPrivate).toBe(true);
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
});
