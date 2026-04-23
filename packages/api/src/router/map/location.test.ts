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
  const createTestRegion = async (opts?: { logoUrl?: string | null }) => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
        ...(opts?.logoUrl !== undefined ? { logoUrl: opts.logoUrl } : {}),
      })
      .returning();

    if (region) {
      createdOrgIds.push(region.id);
    }
    return region;
  };

  // Helper to create test AO
  const createTestAO = async (
    regionId: number,
    opts?: { logoUrl?: string | null },
  ) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Test AO ${uniqueId()}`,
        orgType: "ao",
        parentId: regionId,
        isActive: true,
        ...(opts?.logoUrl !== undefined ? { logoUrl: opts.logoUrl } : {}),
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
    it("should inherit region logo when AO has no logo", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const regionLogo = "https://example.com/region-logo.png";

      // Create region with a custom logo, AO without one
      const region = await createTestRegion({ logoUrl: regionLogo });
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id, { logoUrl: null });
      if (!ao) throw new Error("Failed to create test AO");

      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Logo Inherit Event ${uniqueId()}`,
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

      if (event) {
        createdEventIds.push(event.id);
      }

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      // Map data format: [locationId, name, logo, lat, lon, fullAddress, events[]]
      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === location.id,
      );

      expect(locationData).toBeDefined();
      // logo is at index 2; should be the region logo since AO has none
      expect(locationData?.[2]).toBe(regionLogo);
    });

    it("should use AO logo when AO has its own logo", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const regionLogo = "https://example.com/region-logo2.png";
      const aoLogo = "https://example.com/ao-logo.png";

      // Create region with a logo and AO with its own logo
      const region = await createTestRegion({ logoUrl: regionLogo });
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id, { logoUrl: aoLogo });
      if (!ao) throw new Error("Failed to create test AO");

      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `AO Logo Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (event) {
        createdEventIds.push(event.id);
      }

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === location.id,
      );

      expect(locationData).toBeDefined();
      // AO's own logo should take precedence over region logo
      expect(locationData?.[2]).toBe(aoLogo);
    });

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

    describe("AO grouping", () => {
      it("should include per-event AO name when multiple AOs share a location", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        // Create two AOs with known names under the same region
        const redFoxName = `Red Fox ${uniqueId()}`;
        const ppName = `Pavement Pounders ${uniqueId()}`;

        const [redFoxAo] = await db
          .insert(schema.orgs)
          .values({
            name: redFoxName,
            orgType: "ao",
            parentId: region.id,
            isActive: true,
          })
          .returning();
        if (!redFoxAo) throw new Error("Failed to create Red Fox AO");
        createdOrgIds.push(redFoxAo.id);

        const [ppAo] = await db
          .insert(schema.orgs)
          .values({
            name: ppName,
            orgType: "ao",
            parentId: region.id,
            isActive: true,
          })
          .returning();
        if (!ppAo) throw new Error("Failed to create Pavement Pounders AO");
        createdOrgIds.push(ppAo.id);

        // Both AOs share the same location
        const location = await createTestLocation(region.id);
        if (!location) throw new Error("Failed to create test location");

        const [rfEvent] = await db
          .insert(schema.events)
          .values({
            name: `RF Event ${uniqueId()}`,
            orgId: redFoxAo.id,
            locationId: location.id,
            dayOfWeek: "saturday",
            startTime: "0700",
            isActive: true,
            highlight: false,
            startDate: "2026-01-01",
            isPrivate: false,
          })
          .returning();
        if (rfEvent) createdEventIds.push(rfEvent.id);

        const [ppEvent] = await db
          .insert(schema.events)
          .values({
            name: `PP Event ${uniqueId()}`,
            orgId: ppAo.id,
            locationId: location.id,
            dayOfWeek: "friday",
            startTime: "0530",
            isActive: true,
            highlight: false,
            startDate: "2026-01-01",
            isPrivate: false,
          })
          .returning();
        if (ppEvent) createdEventIds.push(ppEvent.id);

        const client = createTestClient();
        const result = await client.map.location.eventsAndLocations();

        const locationData = result.find(
          (loc: [number, ...unknown[]]) => loc[0] === location.id,
        );
        expect(locationData).toBeDefined();

        // Events are at tuple index 6
        const events = locationData![6] as unknown[][];
        expect(events.length).toBe(2);

        // Event tuple index 7 is aoName
        const aoNames = events.map((e) => e[7] as string);
        expect(aoNames).toContain(redFoxName);
        expect(aoNames).toContain(ppName);
      });

      it("should group multiple events under the same AO name", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        const aoName = `Single AO ${uniqueId()}`;
        const [ao] = await db
          .insert(schema.orgs)
          .values({
            name: aoName,
            orgType: "ao",
            parentId: region.id,
            isActive: true,
          })
          .returning();
        if (!ao) throw new Error("Failed to create test AO");
        createdOrgIds.push(ao.id);

        const location = await createTestLocation(region.id);
        if (!location) throw new Error("Failed to create test location");

        const [event1] = await db
          .insert(schema.events)
          .values({
            name: `Event A ${uniqueId()}`,
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
        if (event1) createdEventIds.push(event1.id);

        const [event2] = await db
          .insert(schema.events)
          .values({
            name: `Event B ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "wednesday",
            startTime: "0600",
            isActive: true,
            highlight: false,
            startDate: "2026-01-01",
            isPrivate: false,
          })
          .returning();
        if (event2) createdEventIds.push(event2.id);

        const client = createTestClient();
        const result = await client.map.location.eventsAndLocations();

        const locationData = result.find(
          (loc: [number, ...unknown[]]) => loc[0] === location.id,
        );
        expect(locationData).toBeDefined();

        const events = locationData![6] as unknown[][];
        expect(events.length).toBe(2);

        // Both events should carry the same AO name (tuple index 5)
        const aoNames = events.map((e) => e[7] as string);
        expect(aoNames).toEqual([aoName, aoName]);
      });
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

  describe("upcomingInstances", () => {
    it("should include a series-linked instance when the parent event has no location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const instanceLocation = await createTestLocation(region.id);
      if (!instanceLocation) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Roving Series ${uniqueId()}`,
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

      if (!event) throw new Error("Failed to create roving series event");
      createdEventIds.push(event.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      await db.insert(schema.eventInstances).values({
        name: `Roving Instance ${uniqueId()}`,
        orgId: ao.id,
        seriesId: event.id,
        locationId: instanceLocation.id,
        startDate,
        startTime: "0600",
        endTime: "0700",
        isActive: true,
        highlight: false,
        isPrivate: false,
      });

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      const rovingInstance = result.find(
        (instance) => instance.seriesId === event.id,
      );

      expect(rovingInstance).toEqual(
        expect.objectContaining({
          seriesId: event.id,
          locationId: instanceLocation.id,
          lat: instanceLocation.latitude,
          lon: instanceLocation.longitude,
          aoName: ao.name,
        }),
      );
    });
  });
});
