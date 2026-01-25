/**
 * Tests for Webhook Event emissions
 *
 * These tests verify that emitWebhookEvent is called correctly
 * for all mutation handlers that modify map data.
 */

import { vi } from "vitest";

// Mock the rate limiter before any imports
const mockLimit = vi.hoisted(() => vi.fn());
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

// Mock notifyWebhooks to capture webhook calls
const mockNotifyWebhooks = vi.hoisted(() => vi.fn());
vi.mock("./notify-webhooks", () => ({
  notifyWebhooks: mockNotifyWebhooks,
}));

import { schema } from "@acme/db";
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

describe("Webhook Events", () => {
  // Track created entities for cleanup
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
    // Reset webhook mock to succeed
    mockNotifyWebhooks.mockResolvedValue(undefined);
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

  describe("Event Router Webhooks", () => {
    it("should emit event.created webhook on event creation", async () => {
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

      const result = await client.event.crupdate({
        name: `Webhook Test Event ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      if (result.event) {
        createdEventIds.push(result.event.id);
      }

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.created",
          eventId: result.event?.id,
        }),
      );
    });

    it("should emit event.updated webhook on event update", async () => {
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

      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await client.event.crupdate({
        id: testEvent.id,
        name: `Updated Event ${uniqueId()}`,
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

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.updated",
          eventId: testEvent.id,
        }),
      );
    });

    it("should emit event.deleted webhook on event deletion", async () => {
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
      await client.event.delete({ id: testEvent.id });

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.deleted",
          eventId: testEvent.id,
        }),
      );
    });
  });

  describe("Location Router Webhooks", () => {
    it("should emit location.created webhook on location creation", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      const result = await client.location.crupdate({
        name: `Webhook Test Location ${uniqueId()}`,
        orgId: region.id,
        isActive: true,
        latitude: 35.5,
        longitude: -80.5,
      });

      if (result.location) {
        createdLocationIds.push(result.location.id);
      }

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.created",
          locationId: result.location?.id,
        }),
      );
    });

    it("should emit location.updated webhook on location update", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await client.location.crupdate({
        id: location.id,
        name: `Updated Location ${uniqueId()}`,
        orgId: region.id,
        isActive: true,
        latitude: 36.0,
        longitude: -81.0,
      });

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.updated",
          locationId: location.id,
        }),
      );
    });

    it("should emit location.deleted webhook on location deletion", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Give the session admin permission on the region
      const adminSession = await createAdminSession();
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
      await client.location.delete({ id: location.id });

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.deleted",
          locationId: location.id,
        }),
      );
    });
  });

  describe("Org Router Webhooks", () => {
    it("should emit org.created webhook on org creation", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const editorSession = createEditorSession({
        orgId: region.id,
        orgName: region.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      const result = await client.org.crupdate({
        name: `Webhook Test AO ${uniqueId()}`,
        orgType: "ao",
        parentId: region.id,
        isActive: true,
        email: null,
      });

      if (result.org) {
        createdOrgIds.push(result.org.id);
      }

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.created",
          orgId: result.org?.id,
        }),
      );
    });

    it("should emit org.updated webhook on org update", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await client.org.crupdate({
        id: ao.id,
        name: `Updated AO ${uniqueId()}`,
        orgType: "ao",
        parentId: region.id,
        isActive: true,
        email: null,
      });

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.updated",
          orgId: ao.id,
        }),
      );
    });

    it("should emit org.deleted webhook on org deletion", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

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
      await client.org.delete({ id: ao.id });

      // Verify notifyWebhooks was called with correct payload
      expect(mockNotifyWebhooks).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "map.deleted",
          orgId: ao.id,
        }),
      );
    });
  });

  describe("Webhook failure handling", () => {
    it("should not fail mutation when webhook fails", async () => {
      // Make notifyWebhooks reject
      mockNotifyWebhooks.mockRejectedValue(new Error("Webhook failed"));

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

      // This should succeed even though webhook fails
      const result = await client.event.crupdate({
        name: `Webhook Fail Test Event ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      if (result.event) {
        createdEventIds.push(result.event.id);
      }

      // The mutation should still succeed
      expect(result.event).toBeDefined();
      expect(result.event?.name).toContain("Webhook Fail Test Event");

      // Webhook was still called (and failed)
      expect(mockNotifyWebhooks).toHaveBeenCalled();
    });
  });
});
