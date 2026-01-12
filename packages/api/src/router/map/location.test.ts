/**
 * Tests for Map Location Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../../__tests__/test-utils";

describe("Map Location Router", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
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

  describe("eventsAndLocations", () => {
    it("should return locations with events for the map", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      expect(Array.isArray(result)).toBe(true);
    });

    it("should exclude private events from map data", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a public event (should appear on map)
      const [publicEvent] = await db
        .insert(schema.events)
        .values({
          name: `Public Map Event ${uniqueId()}`,
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

      // Create a private event (should NOT appear on map)
      const [privateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Private Map Event ${uniqueId()}`,
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
      const result = await client.map.location.eventsAndLocations();

      // Find the location in the results
      // Map data format: [locationId, name, logo, lat, lon, fullAddress, events[]]
      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === location.id,
      );

      if (locationData) {
        // Events are at index 6 in the tuple
        const events = locationData[6] as [number, ...unknown[]][];

        // Public event should be in the events
        const hasPublicEvent = events.some(
          (event: [number, ...unknown[]]) => event[0] === publicEvent?.id,
        );
        expect(hasPublicEvent).toBe(true);

        // Private event should NOT be in the events
        const hasPrivateEvent = events.some(
          (event: [number, ...unknown[]]) => event[0] === privateEvent?.id,
        );
        expect(hasPrivateEvent).toBe(false);
      }
    });

    it("should exclude inactive events from map data", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an inactive event (should NOT appear on map)
      const [inactiveEvent] = await db
        .insert(schema.events)
        .values({
          name: `Inactive Map Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0700",
          isActive: false,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (inactiveEvent) {
        createdEventIds.push(inactiveEvent.id);
      }

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      // Find the location in the results
      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === location.id,
      );

      if (locationData) {
        const events = locationData[6] as [number, ...unknown[]][];

        // Inactive event should NOT be in the events
        const hasInactiveEvent = events.some(
          (event: [number, ...unknown[]]) => event[0] === inactiveEvent?.id,
        );
        expect(hasInactiveEvent).toBe(false);
      }
    });

    it("should only show active public events on the map", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an active public event (should appear)
      const [activePublicEvent] = await db
        .insert(schema.events)
        .values({
          name: `Active Public ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "thursday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (activePublicEvent) {
        createdEventIds.push(activePublicEvent.id);
      }

      // Create an inactive private event (should NOT appear - both conditions fail)
      const [inactivePrivateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Inactive Private ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "friday",
          startTime: "0600",
          isActive: false,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: true,
        })
        .returning();

      if (inactivePrivateEvent) {
        createdEventIds.push(inactivePrivateEvent.id);
      }

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      // Find the location in the results
      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === location.id,
      );

      if (locationData) {
        const events = locationData[6] as [number, ...unknown[]][];

        // Active public event should be in the events
        const hasActivePublic = events.some(
          (event: [number, ...unknown[]]) => event[0] === activePublicEvent?.id,
        );
        expect(hasActivePublic).toBe(true);

        // Inactive private event should NOT be in the events
        const hasInactivePrivate = events.some(
          (event: [number, ...unknown[]]) =>
            event[0] === inactivePrivateEvent?.id,
        );
        expect(hasInactivePrivate).toBe(false);
      }
    });
  });
});

