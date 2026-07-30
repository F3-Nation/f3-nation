/**
 * Tests for Request Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 *
 * Note: The request router handles update/delete requests for the map.
 * It has complex permission logic and integrates with locations, events, AOs, etc.
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());
const mockNotifyMapDataChange = vi.hoisted(() => vi.fn());
const mockNotifyMapChangeRequest = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../lib/webhook-events", () => ({
  notifyMapDataChange: mockNotifyMapDataChange,
}));

vi.mock("../services/map-request-notification", () => ({
  notifyMapChangeRequest: mockNotifyMapChangeRequest,
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

describe("Request Router", () => {
  // Track created entities for cleanup
  const createdRequestIds: string[] = [];
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
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
    mockNotifyMapChangeRequest.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    // Clean up in reverse order
    for (const requestId of createdRequestIds.reverse()) {
      try {
        await cleanup.updateRequest(requestId);
      } catch {
        // Ignore errors during cleanup
      }
    }
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

  // Helper to create test event
  const createTestEvent = async (aoId: number, locationId: number) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `Test Event ${uniqueId()}`,
        orgId: aoId,
        locationId,
        dayOfWeek: "monday",
        startTime: "0530",
        isActive: true,
        highlight: false,
        startDate: "2026-01-01",
      })
      .returning();

    if (event) {
      createdEventIds.push(event.id);
    }
    return event;
  };

  describe("all", () => {
    it("should return a list of update requests", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("requests");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.requests)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const page1 = await client.request.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.request.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.requests.length).toBeLessThanOrEqual(2);
      expect(page2.requests.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 requests
      if (
        page1.totalCount > 2 &&
        page1.requests.length > 0 &&
        page2.requests.length > 0
      ) {
        expect(page1.requests[0]?.id).not.toBe(page2.requests[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.all({
        statuses: ["pending"],
        pageIndex: 0,
        pageSize: 10,
      });

      // All returned requests should have the specified status
      expect(result.requests.every((r) => r.status === "pending")).toBe(true);
    });

    it("should search requests", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.all({
        searchTerm: "test",
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("requests");
      expect(Array.isArray(result.requests)).toBe(true);
    });
  });

  describe("byId", () => {
    it("should return a request by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a test request
      const [testRequest] = await db
        .insert(schema.updateRequests)
        .values({
          regionId: region.id,
          requestType: "create_event",
          eventName: `Test Request ${uniqueId()}`,
          submittedBy: "test@example.com",
          status: "pending",
        })
        .returning();

      if (!testRequest) return;
      createdRequestIds.push(testRequest.id);

      const client = createTestClient();
      const result = await client.request.byId({
        id: testRequest.id,
      });

      expect(result).toHaveProperty("request");
      expect(result.request).not.toBeNull();
      expect(result.request?.id).toBe(testRequest.id);
    });

    it("should return null for non-existent request", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.byId({
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(result.request).toBeNull();
    });
  });

  describe("canDeleteEvent", () => {
    it("should return false when no pending delete request exists", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const client = createTestClient();
      const result = await client.request.canDeleteEvent({
        eventId: event.id,
      });

      // Returns false because no pending delete request exists
      expect(result.canDelete).toBe(false);
    });

    it("should return true when pending delete request exists", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // Create a pending delete request for this event
      const [deleteRequest] = await db
        .insert(schema.updateRequests)
        .values({
          regionId: region.id,
          eventId: event.id,
          requestType: "delete_event",
          eventName: event.name,
          submittedBy: "test@example.com",
          status: "pending",
        })
        .returning();

      if (deleteRequest) {
        createdRequestIds.push(deleteRequest.id);
      }

      const client = createTestClient();
      const result = await client.request.canDeleteEvent({
        eventId: event.id,
      });

      expect(result.canDelete).toBe(true);
    });
  });

  describe("canEditRegions", () => {
    it("should check multiple orgs at once", async () => {
      const region1 = await createTestRegion();
      const region2 = await createTestRegion();
      if (!region1 || !region2) return;

      // Only has permission on region1
      const session = createEditorSession({
        orgId: region1.id,
        orgName: region1.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.canEditRegions({
        orgIds: [region1.id, region2.id],
      });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(2);
      // First should have permission, second should not
      expect(result.results[0]?.success).toBe(true);
      expect(result.results[1]?.success).toBe(false);
    });

    it("should return true for users with editor permission", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.canEditRegions({
        orgIds: [region.id],
      });

      expect(result.results).toBeDefined();
      expect(result.results.length).toBe(1);
      expect(result.results[0]?.success).toBe(true);
    });

    it("should return false for users without permission", async () => {
      const region = await createTestRegion();
      if (!region) return;

      // Session with permission on a different org
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.request.canEditRegions({
        orgIds: [region.id],
      });

      expect(result.results).toBeDefined();
      expect(result.results.every((r) => r.success === false)).toBe(true);
    });
  });

  describe("map data change notifications", () => {
    it("fires notifyMapDataChange when a request is applied (approved)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // Admin on F3 Nation has editor rights on descendants, so the delete
      // request is applied immediately instead of going to review.
      const client = createTestClient();
      const result = await client.request.submitDeleteEventRequest({
        id: crypto.randomUUID(),
        requestType: "delete_event",
        submittedBy: "admin@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });
      createdRequestIds.push(result.updateRequest.id);

      expect(result.status).toBe("approved");
      expect(mockNotifyMapDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "map.deleted", eventId: event.id }),
      );

      // The approved row records who applied the change
      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id));
      expect(savedRequest?.reviewedBy).toBe(session.user?.email);
      expect(savedRequest?.reviewedAt).toBeTruthy();
    });

    it("does not fire notifyMapDataChange when the request stays pending", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // Editor on an unrelated org has no permission on this region.
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      const result = await client.request.submitDeleteEventRequest({
        id: crypto.randomUUID(),
        requestType: "delete_event",
        submittedBy: "editor@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });
      createdRequestIds.push(result.updateRequest.id);

      expect(result.status).toBe("pending");
      expect(mockNotifyMapDataChange).not.toHaveBeenCalled();

      // A pending row has no reviewer yet
      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id));
      expect(savedRequest?.reviewedBy).toBeNull();
      expect(savedRequest?.reviewedAt).toBeNull();
    });

    it("fires notifyMapChangeRequest to alert admins when a submission lands pending", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // Editor on an unrelated org has no permission on this region, so the
      // request is recorded pending instead of applied.
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      const result = await client.request.submitDeleteEventRequest({
        id: crypto.randomUUID(),
        requestType: "delete_event",
        submittedBy: "editor@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });
      createdRequestIds.push(result.updateRequest.id);

      expect(result.status).toBe("pending");
      expect(mockNotifyMapChangeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: result.updateRequest.id }),
      );
    });

    it("swallows a notifyMapChangeRequest failure instead of failing the submission", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      mockNotifyMapChangeRequest.mockRejectedValueOnce(
        new Error("notification service unavailable"),
      );

      const client = createTestClient();
      const result = await client.request.submitDeleteEventRequest({
        id: crypto.randomUUID(),
        requestType: "delete_event",
        submittedBy: "editor@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });
      createdRequestIds.push(result.updateRequest.id);

      expect(mockNotifyMapChangeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: result.updateRequest.id }),
      );

      // The submission itself must succeed as pending despite the failed notify
      expect(result.status).toBe("pending");
      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id));
      expect(savedRequest?.status).toBe("pending");
    });
  });

  describe("approved request atomicity", () => {
    it("rolls back the applied change when recording the audit row fails", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // A non-UUID id passes schema validation but makes the updateRequests
      // insert fail, after the delete handler has already run.
      const client = createTestClient();
      await expect(
        client.request.submitDeleteEventRequest({
          id: "not-a-uuid",
          requestType: "delete_event",
          submittedBy: "admin@example.com",
          originalEventId: event.id,
          originalRegionId: region.id,
        }),
      ).rejects.toThrow();

      // The event deactivation must have been rolled back
      const [unchangedEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(unchangedEvent?.isActive).toBe(true);
      expect(mockNotifyMapDataChange).not.toHaveBeenCalled();
    });

    it("applies a multi-write handler through the nested transactions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // delete_ao writes both the AO and its events; it runs as a savepoint
      // inside handleRequest's transaction (with updateAO nesting once more).
      const client = createTestClient();
      const result = await client.request.submitDeleteAORequest({
        id: crypto.randomUUID(),
        requestType: "delete_ao",
        submittedBy: "admin@example.com",
        originalAoId: ao.id,
        originalRegionId: region.id,
      });
      createdRequestIds.push(result.updateRequest.id);

      expect(result.status).toBe("approved");
      const [savedAo] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, ao.id));
      const [savedEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(savedAo?.isActive).toBe(false);
      expect(savedEvent?.isActive).toBe(false);
    });
  });

  describe("approved create requests", () => {
    it("records the created event id on the approved request row", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;

      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
        })
        .returning();
      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      const client = createTestClient();
      const result = await client.request.submitCreateEventRequest({
        id: crypto.randomUUID(),
        requestType: "create_event",
        submittedBy: "admin@example.com",
        originalAoId: ao.id,
        originalLocationId: location.id,
        originalRegionId: region.id,
        eventName: `Created Event ${uniqueId()}`,
        eventDayOfWeek: "monday",
        eventStartTime: "0530",
        eventEndTime: "0615",
        eventTypeIds: [eventType.id],
      });
      createdRequestIds.push(result.updateRequest.id ?? "");
      if (result.updateRequest.eventId) {
        createdEventIds.push(result.updateRequest.eventId);
      }

      expect(result.status).toBe("approved");

      // The approved row links to the event the handler just created
      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id ?? ""));
      expect(savedRequest?.eventId).toBeTruthy();

      const [createdEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, savedRequest?.eventId ?? -1));
      expect(createdEvent?.orgId).toBe(ao.id);

      // The webhook payload carries the created event id too
      expect(mockNotifyMapDataChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "map.created",
          eventId: savedRequest?.eventId,
        }),
      );
    });

    it("records the created ao, location, and event ids on the approved request row", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
        })
        .returning();
      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      const client = createTestClient();
      const result =
        await client.request.submitCreateAOAndLocationAndEventRequest({
          id: crypto.randomUUID(),
          requestType: "create_ao_and_location_and_event",
          submittedBy: "admin@example.com",
          originalRegionId: region.id,
          aoName: `Created AO ${uniqueId()}`,
          eventName: `Created Event ${uniqueId()}`,
          eventDayOfWeek: "monday",
          eventStartTime: "0530",
          eventEndTime: "0615",
          eventTypeIds: [eventType.id],
          locationLat: 36.21,
          locationLng: -81.68,
          locationAddress: "123 Test Street",
          locationCity: "Boone",
          locationState: "NC",
          locationZip: "28607",
          locationCountry: "United States",
        });
      createdRequestIds.push(result.updateRequest.id ?? "");

      expect(result.status).toBe("approved");

      // The approved row links to all three entities the handler created — not
      // just the event (the create_event case above), but the AO and location
      // too (created.aoId/locationId → the aoId/locationId columns). (#5)
      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id ?? ""));
      expect(savedRequest?.aoId).toBeTruthy();
      expect(savedRequest?.locationId).toBeTruthy();
      expect(savedRequest?.eventId).toBeTruthy();

      if (savedRequest?.aoId) createdOrgIds.push(savedRequest.aoId);
      if (savedRequest?.locationId)
        createdLocationIds.push(savedRequest.locationId);
      if (savedRequest?.eventId) createdEventIds.push(savedRequest.eventId);

      // The created event belongs to the created AO, and the AO to the region
      const [createdEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, savedRequest?.eventId ?? -1));
      expect(createdEvent?.orgId).toBe(savedRequest?.aoId);

      const [createdAo] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, savedRequest?.aoId ?? -1));
      expect(createdAo?.parentId).toBe(region.id);

      // The webhook payload carries all three created ids
      expect(mockNotifyMapDataChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "map.created",
          eventId: savedRequest?.eventId,
          locationId: savedRequest?.locationId,
          orgId: savedRequest?.aoId,
        }),
      );
    });
  });

  describe("submitMoveEventToDifferentAoRequest", () => {
    it("rejects a request without a destination AO instead of silently no-oping", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      await expect(
        // @ts-expect-error -- deliberately omits the required newAoId
        client.request.submitMoveEventToDifferentAoRequest({
          id: crypto.randomUUID(),
          requestType: "move_event_to_different_ao",
          submittedBy: "admin@example.com",
          originalEventId: 1,
          originalAoId: 1,
          originalRegionId: 1,
        }),
      ).rejects.toThrow();
    });

    it("hydrates the destination AO's name and default location onto the approved request row", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const sourceAo = await createTestAO(region.id);
      if (!sourceAo) return;
      const sourceLocation = await createTestLocation(sourceAo.id);
      if (!sourceLocation) return;
      const event = await createTestEvent(sourceAo.id, sourceLocation.id);
      if (!event) return;

      const destinationAo = await createTestAO(region.id);
      if (!destinationAo) return;
      const destinationLocation = await createTestLocation(destinationAo.id);
      if (!destinationLocation) return;

      // Give the destination AO a default location with address details
      // distinct from anything the client submits, so a passing assertion
      // can only mean hydrateDestinationAo's join actually ran.
      await db
        .update(schema.orgs)
        .set({ defaultLocationId: destinationLocation.id })
        .where(eq(schema.orgs.id, destinationAo.id));
      await db
        .update(schema.locations)
        .set({
          addressStreet: "999 Destination Ave",
          addressCity: "Destination City",
          addressState: "NC",
          addressZip: "28999",
        })
        .where(eq(schema.locations.id, destinationLocation.id));

      const client = createTestClient();
      const result = await client.request.submitMoveEventToDifferentAoRequest({
        id: crypto.randomUUID(),
        requestType: "move_event_to_different_ao",
        submittedBy: "admin@example.com",
        originalEventId: event.id,
        originalAoId: sourceAo.id,
        originalRegionId: region.id,
        newAoId: destinationAo.id,
        // newLocationId is deliberately omitted — the map UI never sends it
        // for this request type (see location-edit-buttons.tsx), relying on
        // the backend to hydrate it from the destination AO's default
        // location instead.
      });
      createdRequestIds.push(result.updateRequest.id ?? "");

      expect(result.status).toBe("approved");

      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id ?? ""));

      expect(savedRequest?.aoId).toBe(destinationAo.id);
      expect(savedRequest?.aoName).toBe(destinationAo.name);
      expect(savedRequest?.locationId).toBe(destinationLocation.id);
      expect(savedRequest?.locationAddress).toBe("999 Destination Ave");
      expect(savedRequest?.locationCity).toBe("Destination City");

      // The webhook payload (and the map cache invalidation it drives) must
      // point at the destination location too, not the source.
      expect(mockNotifyMapDataChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "map.updated",
          locationId: destinationLocation.id,
          orgId: destinationAo.id,
        }),
      );
    });
  });

  describe("submitMoveEventToNewLocationRequest", () => {
    it("backfills the event's existing name, schedule, and event types onto the approved request row", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const originalLocation = await createTestLocation(ao.id);
      if (!originalLocation) return;
      const event = await createTestEvent(ao.id, originalLocation.id);
      if (!event) return;

      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
        })
        .returning();
      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      // Give the event a distinguishing name/description the request never
      // submits, plus an event type — move_event_to_new_location's schema has
      // no event-field slots at all, so hydrateEventFields must copy these
      // straight from the existing row.
      await db
        .update(schema.events)
        .set({
          name: "Original Beatdown Name",
          description: "Original beatdown description",
        })
        .where(eq(schema.events.id, event.id));
      await db.insert(schema.eventsXEventTypes).values({
        eventId: event.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      const result = await client.request.submitMoveEventToNewLocationRequest({
        id: crypto.randomUUID(),
        requestType: "move_event_to_new_location",
        submittedBy: "admin@example.com",
        originalEventId: event.id,
        originalLocationId: originalLocation.id,
        originalRegionId: region.id,
        locationLat: 35.9,
        locationLng: -81.1,
        locationAddress: "42 New Location Way",
        locationCity: "Newtown",
        locationState: "NC",
        locationZip: "28601",
        locationCountry: "United States",
      });
      createdRequestIds.push(result.updateRequest.id ?? "");

      expect(result.status).toBe("approved");

      const [savedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, result.updateRequest.id ?? ""));
      if (savedRequest?.locationId) {
        createdLocationIds.push(savedRequest.locationId);
      }

      // The client never sent any of these — they must come from the
      // existing event row.
      expect(savedRequest?.eventName).toBe("Original Beatdown Name");
      expect(savedRequest?.eventDescription).toBe(
        "Original beatdown description",
      );
      expect(savedRequest?.eventDayOfWeek).toBe("monday");
      expect(savedRequest?.eventStartTime).toBe("0530");
      expect(savedRequest?.eventTypeIds).toEqual([eventType.id]);

      // The location itself must be the newly created destination, not the
      // original.
      expect(savedRequest?.locationId).not.toBe(originalLocation.id);
      expect(savedRequest?.locationAddress).toBe("42 New Location Way");
    });
  });

  describe("validateSubmissionByAdmin", () => {
    it("throws UNAUTHORIZED when the reviewer has no editor role on the request's region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      // Editor on an unrelated org must not be able to review this region
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.request.validateSubmissionByAdmin({
          id: crypto.randomUUID(),
          requestType: "delete_event",
          submittedBy: "test@example.com",
          originalEventId: event.id,
          originalRegionId: region.id,
        }),
      ).rejects.toThrow(/not authorized/i);

      expect(mockNotifyMapDataChange).not.toHaveBeenCalled();
    });

    it("throws UNAUTHORIZED when the reviewer lacks permission on another affected region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const originalRegion = await createTestRegion();
      if (!originalRegion) return;
      const newRegion = await createTestRegion();
      if (!newRegion) return;
      const ao = await createTestAO(originalRegion.id);
      if (!ao) return;

      // Editor on the target region only: allowed to review that region, but
      // the move also affects the original region, so the approve must fail
      // loudly instead of silently re-recording the request as pending.
      const targetRegionSession = createEditorSession({
        orgId: newRegion.id,
        orgName: newRegion.name,
      });
      await mockAuthWithSession(targetRegionSession);

      const client = createTestClient();
      await expect(
        client.request.validateSubmissionByAdmin({
          id: crypto.randomUUID(),
          requestType: "move_ao_to_different_region",
          submittedBy: "editor@example.com",
          originalAoId: ao.id,
          originalRegionId: originalRegion.id,
          newRegionId: newRegion.id,
        }),
      ).rejects.toThrow(/ask an admin/i);
      expect(mockNotifyMapDataChange).not.toHaveBeenCalled();
    });
  });

  describe("rejectSubmission", () => {
    it("should reject a pending request", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a test request
      const [testRequest] = await db
        .insert(schema.updateRequests)
        .values({
          regionId: region.id,
          requestType: "create_event",
          eventName: `Reject Test ${uniqueId()}`,
          submittedBy: "test@example.com",
          status: "pending",
        })
        .returning();

      if (!testRequest) return;
      createdRequestIds.push(testRequest.id);

      // Give session editor permission on this region
      session.roles?.push({
        orgId: region.id,
        orgName: region.name,
        roleName: "editor",
      });
      session.user?.roles?.push({
        orgId: region.id,
        orgName: region.name,
        roleName: "editor",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();
      await client.request.rejectSubmission({
        id: testRequest.id,
      });

      // Verify it's rejected and the reviewer is stamped
      const [rejectedRequest] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, testRequest.id));

      expect(rejectedRequest?.status).toBe("rejected");
      expect(rejectedRequest?.reviewedBy).toBe("admin@example.com");
      expect(rejectedRequest?.reviewedAt).not.toBeNull();
    });

    it("should require editor permission to reject", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a test request
      const [testRequest] = await db
        .insert(schema.updateRequests)
        .values({
          regionId: region.id,
          requestType: "create_event",
          eventName: `Reject Auth Test ${uniqueId()}`,
          submittedBy: "test@example.com",
          status: "pending",
        })
        .returning();

      if (!testRequest) return;
      createdRequestIds.push(testRequest.id);

      // Session with no permission on this region
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.request.rejectSubmission({
          id: testRequest.id,
        }),
      ).rejects.toThrow();
    });

    it("throws NOT_FOUND for a non-existent request", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.request.rejectSubmission({
          id: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Failed to find update request",
      });
    });
  });

  describe("validateSubmissionByAdmin", () => {
    it("throws BAD_REQUEST when the end time is before the start time", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(ao.id);
      if (!location) return;

      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
        })
        .returning();
      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Every other field is deliberately valid so the reversed times are the
      // only thing left to reject. With an invalid id / missing ao / null
      // eventTypeIds the union fails first and the time-order refinement never
      // runs, which is what made this assertion unreachable.
      const error: unknown = await client.request
        .validateSubmissionByAdmin({
          id: crypto.randomUUID(),
          regionId: region.id,
          requestType: "create_event",
          eventName: `Bad Time Test ${uniqueId()}`,
          eventDayOfWeek: "monday",
          eventStartTime: "0800",
          eventEndTime: "0700",
          eventTypeIds: [eventType.id],
          aoId: ao.id,
          locationId: location.id,
          aoName: "Test AO",
          submittedBy: "submitter@example.com",
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      const issues =
        (
          error as {
            data?: { issues?: { path?: unknown[]; message?: string }[] };
          }
        ).data?.issues ?? [];
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ["eventEndTime"],
          message: "End time must be after start time",
        }),
      );
    });

    it("throws BAD_REQUEST when a delete_event request has neither eventId nor locationId", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      // `DeleteEventSchema` requires a positive `originalEventId`, so a request
      // that names no event is refused at the input boundary rather than by a
      // handler-level guard — earlier, and with the offending field named. A
      // valid UUID `id` is supplied deliberately so the missing event id is the
      // only possible reason for rejection; otherwise this would pass on an
      // unrelated validation error and stop testing anything.
      const error: unknown = await client.request
        .validateSubmissionByAdmin({
          id: crypto.randomUUID(),
          regionId: region.id,
          requestType: "delete_event",
          eventName: `Nothing To Delete Test ${uniqueId()}`,
          eventDayOfWeek: "monday",
          eventStartTime: "0600",
          eventEndTime: "0700",
          eventTypeIds: null,
          aoName: "Test AO",
          submittedBy: "submitter@example.com",
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      const issues =
        (error as { data?: { issues?: { path?: unknown[] }[] } }).data
          ?.issues ?? [];
      expect(
        issues.some((issue) => issue.path?.[0] === "originalEventId"),
      ).toBe(true);
    });

    it("throws NOT_FOUND when locationId references a location that does not exist", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Test Event Type ${uniqueId()}`,
          eventCategory: "first_f",
        })
        .returning();
      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.request.validateSubmissionByAdmin({
          // The create_event branch of the union requires a UUID `id`, a
          // positive `originalAoId` (backfilled from `aoId`), and at least one
          // event type. Without all three the input boundary rejects with
          // BAD_REQUEST and the location lookup under test never runs.
          id: crypto.randomUUID(),
          regionId: region.id,
          requestType: "create_event",
          eventName: `Bad Location Test ${uniqueId()}`,
          eventDayOfWeek: "monday",
          eventStartTime: "0600",
          eventEndTime: "0700",
          eventTypeIds: [eventType.id],
          aoId: ao.id,
          aoName: "Test AO",
          submittedBy: "submitter@example.com",
          locationId: 999999999,
          locationDescription: "Updated description",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Failed to find location to update",
      });
    });

    it("throws NOT_FOUND when newLocationId references a location that does not exist", async () => {
      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(ao.id);
      if (!location) return;

      const session = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      // `handleMoveAOToDifferentLocation` writes a non-null `newLocationId`
      // straight into `events.locationId` / `orgs.defaultLocationId`, so a
      // dangling target must be caught by the preflight — otherwise the FK
      // constraint fires and oRPC masks it as an opaque 500. The
      // `originalLocationId` here is real, so the only broken reference is the
      // target, and the message must say so.
      await expect(
        client.request.validateSubmissionByAdmin({
          id: crypto.randomUUID(),
          regionId: region.id,
          requestType: "move_ao_to_different_location",
          originalAoId: ao.id,
          originalLocationId: location.id,
          newLocationId: 999999999,
          submittedBy: "submitter@example.com",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Failed to find target location",
      });
    });
  });

  // Helper: insert a stored pending request row (the approve path requires a
  // matching pending row — see the #11 status guard).
  const insertPendingRequest = async (values: {
    id: string;
    regionId: number;
    requestType: typeof schema.updateRequests.$inferInsert.requestType;
  }) => {
    const [row] = await db
      .insert(schema.updateRequests)
      .values({
        id: values.id,
        regionId: values.regionId,
        requestType: values.requestType,
        submittedBy: "submitter@example.com",
        status: "pending",
      })
      .returning();
    if (row) createdRequestIds.push(row.id);
    return row;
  };

  describe("validateSubmissionByAdmin — approve success path (#10)", () => {
    it("applies an authorized reviewer's approval end-to-end and stamps reviewedBy", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: region.id,
        requestType: "delete_event",
      });

      const client = createTestClient();
      const result = await client.request.validateSubmissionByAdmin({
        id: requestId,
        requestType: "delete_event",
        submittedBy: "submitter@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });

      expect(result.status).toBe("approved");

      // Domain mutation applied
      const [applied] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(applied?.isActive).toBe(false);

      // Audit row flipped to approved with the reviewer stamped
      const [row] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, requestId));
      expect(row?.status).toBe("approved");
      expect(row?.reviewedBy).toBe("admin@example.com");
      expect(row?.reviewedAt).not.toBeNull();
      expect(mockNotifyMapDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "map.deleted" }),
      );
    });
  });

  describe("submit*Request review path — permission gate parity with validateSubmissionByAdmin", () => {
    it("throws UNAUTHORIZED instead of re-recording as pending when reviewing an existing row without permission on an affected org", async () => {
      const admin = await createAdminSession();
      await mockAuthWithSession(admin);

      const originalRegion = await createTestRegion();
      if (!originalRegion) return;
      const newRegion = await createTestRegion();
      if (!newRegion) return;
      const ao = await createTestAO(originalRegion.id);
      if (!ao) return;

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: newRegion.id,
        requestType: "move_ao_to_different_region",
      });

      // Editor on the target region only, matching what the map's review UI
      // (which only checks originalRegionId/newRegionId) would let through as
      // "canEdit". The original region is also affected by this move, so the
      // plain submit endpoint's Approve call must fail loudly instead of
      // silently re-recording the request as pending and re-notifying admins.
      const targetRegionSession = createEditorSession({
        orgId: newRegion.id,
        orgName: newRegion.name,
      });
      await mockAuthWithSession(targetRegionSession);

      const client = createTestClient();
      await expect(
        client.request.submitMoveAOToDifferentRegionRequest({
          id: requestId,
          requestType: "move_ao_to_different_region",
          submittedBy: "editor@example.com",
          originalAoId: ao.id,
          originalRegionId: originalRegion.id,
          newRegionId: newRegion.id,
        }),
      ).rejects.toThrow(/ask an admin/i);

      expect(mockNotifyMapDataChange).not.toHaveBeenCalled();

      // The stored row must remain pending, not be silently re-recorded
      const [row] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, requestId));
      expect(row?.status).toBe("pending");
    });

    it("still applies an authorized reviewer's approval when reviewing an existing pending row via the plain submit endpoint", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: region.id,
        requestType: "delete_event",
      });

      const client = createTestClient();
      const result = await client.request.submitDeleteEventRequest({
        id: requestId,
        requestType: "delete_event",
        submittedBy: "submitter@example.com",
        originalEventId: event.id,
        originalRegionId: region.id,
      });

      expect(result.status).toBe("approved");
      const [applied] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(applied?.isActive).toBe(false);
    });

    it("throws UNAUTHORIZED rather than flipping an already-resolved request back to pending", async () => {
      const admin = await createAdminSession();
      await mockAuthWithSession(admin);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const requestId = crypto.randomUUID();
      const [seeded] = await db
        .insert(schema.updateRequests)
        .values({
          id: requestId,
          regionId: region.id,
          requestType: "delete_event",
          submittedBy: "submitter@example.com",
          status: "approved",
          reviewedBy: "admin@example.com",
          reviewedAt: new Date().toISOString(),
        })
        .returning();
      if (seeded) createdRequestIds.push(seeded.id);

      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.request.submitDeleteEventRequest({
          id: requestId,
          requestType: "delete_event",
          submittedBy: "editor@example.com",
          originalEventId: event.id,
          originalRegionId: region.id,
        }),
      ).rejects.toThrow(/ask an admin/i);

      const [after] = await db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, requestId));
      expect(after?.status).toBe("approved");
    });
  });

  describe("checkUpdatePermissions cross-region matrix (#7)", () => {
    it("approves a region move only when the reviewer edits BOTH source and target", async () => {
      const admin = await createAdminSession();
      await mockAuthWithSession(admin);

      const source = await createTestRegion();
      if (!source) return;
      const target = await createTestRegion();
      if (!target) return;
      const ao = await createTestAO(source.id);
      if (!ao) return;

      // Editor on BOTH regions — the `.every(c => c.success)` rule should pass.
      const session = createEditorSession({
        orgId: source.id,
        orgName: source.name,
      });
      session.roles?.push({
        orgId: target.id,
        orgName: target.name,
        roleName: "editor",
      });
      session.user?.roles?.push({
        orgId: target.id,
        orgName: target.name,
        roleName: "editor",
      });
      await mockAuthWithSession(session);

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: target.id,
        requestType: "move_ao_to_different_region",
      });

      const client = createTestClient();
      const result = await client.request.validateSubmissionByAdmin({
        id: requestId,
        requestType: "move_ao_to_different_region",
        submittedBy: "submitter@example.com",
        originalAoId: ao.id,
        originalRegionId: source.id,
        newRegionId: target.id,
      });

      expect(result.status).toBe("approved");
      const [movedAo] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, ao.id));
      expect(movedAo?.parentId).toBe(target.id);
    });
  });

  describe("validateSubmissionByAdmin — reviewer-edited region (#8)", () => {
    it("moves the AO to the reviewer's edited destination, not the originally-requested one", async () => {
      const admin = await createAdminSession();
      await mockAuthWithSession(admin);

      const source = await createTestRegion();
      if (!source) return;
      const requested = await createTestRegion();
      if (!requested) return;
      const edited = await createTestRegion();
      if (!edited) return;
      const ao = await createTestAO(source.id);
      if (!ao) return;

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: requested.id,
        requestType: "move_ao_to_different_region",
      });

      // The review form re-submits meta.newRegionId (the originally requested
      // region) but the RegionSelectField wrote the *edited* destination into
      // regionId. The edited region must win.
      const client = createTestClient();
      await client.request.validateSubmissionByAdmin({
        id: requestId,
        requestType: "move_ao_to_different_region",
        submittedBy: "submitter@example.com",
        originalAoId: ao.id,
        originalRegionId: source.id,
        regionId: edited.id,
        meta: { newRegionId: requested.id, originalRegionId: source.id },
      });

      const [movedAo] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, ao.id));
      expect(movedAo?.parentId).toBe(edited.id);
      expect(movedAo?.parentId).not.toBe(requested.id);
    });
  });

  describe("validateSubmissionByAdmin — double-review guard (#11)", () => {
    it("409s when approving an already-approved request", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;
      const event = await createTestEvent(ao.id, location.id);
      if (!event) return;

      const requestId = crypto.randomUUID();
      const [row] = await db
        .insert(schema.updateRequests)
        .values({
          id: requestId,
          regionId: region.id,
          requestType: "delete_event",
          submittedBy: "submitter@example.com",
          status: "approved", // already resolved
        })
        .returning();
      if (row) createdRequestIds.push(row.id);

      const client = createTestClient();
      await expect(
        client.request.validateSubmissionByAdmin({
          id: requestId,
          requestType: "delete_event",
          submittedBy: "submitter@example.com",
          originalEventId: event.id,
          originalRegionId: region.id,
        }),
      ).rejects.toThrow(/already been approved/i);

      // The apply handler must not have run a second time
      const [unchanged] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(unchanged?.isActive).toBe(true);
    });

    it("409s when rejecting an already-rejected request", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;
      session.roles?.push({
        orgId: region.id,
        orgName: region.name,
        roleName: "editor",
      });
      session.user?.roles?.push({
        orgId: region.id,
        orgName: region.name,
        roleName: "editor",
      });
      await mockAuthWithSession(session);

      const requestId = crypto.randomUUID();
      const [row] = await db
        .insert(schema.updateRequests)
        .values({
          id: requestId,
          regionId: region.id,
          requestType: "create_event",
          eventName: `Already Rejected ${uniqueId()}`,
          submittedBy: "submitter@example.com",
          status: "rejected",
        })
        .returning();
      if (row) createdRequestIds.push(row.id);

      const client = createTestClient();
      await expect(
        client.request.rejectSubmission({ id: requestId }),
      ).rejects.toThrow(/already been reviewed/i);
    });
  });

  describe("moveAOLocsToNewRegion carries each event to its own location (#14)", () => {
    it("lands each event on the copy of its own location, not all on the last one", async () => {
      const admin = await createAdminSession();
      await mockAuthWithSession(admin);

      const source = await createTestRegion();
      if (!source) return;
      const target = await createTestRegion();
      if (!target) return;
      const ao = await createTestAO(source.id);
      if (!ao) return;

      // Two DISTINCT locations in the source region, one event on each.
      const locA = await createTestLocation(source.id);
      const locB = await createTestLocation(source.id);
      if (!locA || !locB) return;
      const eventA = await createTestEvent(ao.id, locA.id);
      const eventB = await createTestEvent(ao.id, locB.id);
      if (!eventA || !eventB) return;

      const requestId = crypto.randomUUID();
      await insertPendingRequest({
        id: requestId,
        regionId: target.id,
        requestType: "move_ao_to_different_region",
      });

      const client = createTestClient();
      await client.request.validateSubmissionByAdmin({
        id: requestId,
        requestType: "move_ao_to_different_region",
        submittedBy: "submitter@example.com",
        originalAoId: ao.id,
        originalRegionId: source.id,
        newRegionId: target.id,
      });

      const [movedA] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventA.id));
      const [movedB] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, eventB.id));

      const [newLocA] = await db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, movedA?.locationId ?? -1));
      const [newLocB] = await db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, movedB?.locationId ?? -1));
      if (newLocA) createdLocationIds.push(newLocA.id);
      if (newLocB) createdLocationIds.push(newLocB.id);

      // Each event follows the copy of ITS OWN location (identified by name),
      // in the target region — not both piled onto the last location's copy.
      expect(newLocA?.name).toBe(locA.name);
      expect(newLocB?.name).toBe(locB.name);
      expect(newLocA?.orgId).toBe(target.id);
      expect(newLocB?.orgId).toBe(target.id);
      expect(movedA?.locationId).not.toBe(movedB?.locationId);
    });
  });
});
