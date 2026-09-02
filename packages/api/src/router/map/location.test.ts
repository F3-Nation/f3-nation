/**
 * Tests for Map Location Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { eq, schema, sql } from "@acme/db";
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

  // Helper to create test area (sits between the nation and a region)
  const createTestArea = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [area] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Area ${uniqueId()}`,
        orgType: "area",
        parentId: nationOrg.id,
        isActive: true,
      })
      .returning();

    if (area) {
      createdOrgIds.push(area.id);
    }
    return area;
  };

  // Helper to create test region
  const createTestRegion = async (opts?: {
    logoUrl?: string | null;
    parentId?: number;
  }) => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Region ${uniqueId()}`,
        orgType: "region",
        parentId: opts?.parentId ?? nationOrg.id,
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

  /**
   * Postgres `CURRENT_DATE` as a `YYYY-MM-DD` string.
   *
   * The router's date window compares `start_date`/`end_date` against
   * `CURRENT_DATE`, which the *database session's* timezone resolves. Anchoring
   * the boundary fixtures on the value the database itself reports keeps them
   * deterministic even when the test process runs in a different timezone.
   */
  const getDbCurrentDate = async (): Promise<string> => {
    const rows = await db.execute<{ today: string }>(
      sql`SELECT CURRENT_DATE::text AS today`,
    );
    const today = rows[0]?.today;
    if (!today) {
      throw new Error("Failed to read CURRENT_DATE from the test database");
    }
    return today;
  };

  /** Shifts a `YYYY-MM-DD` string by whole days using UTC math (DST-proof). */
  const shiftDays = (isoDate: string, days: number): string => {
    const [year, month, day] = isoDate.split("-").map(Number);
    if (year == null || month == null || day == null) {
      throw new Error(`Unexpected date string: ${isoDate}`);
    }
    return new Date(Date.UTC(year, month - 1, day + days))
      .toISOString()
      .split("T")[0]!;
  };

  // Helper to create a test event with explicit start/end dates
  const createDatedEvent = async (opts: {
    aoId: number;
    locationId: number;
    label: string;
    dayOfWeek: (typeof schema.events.$inferInsert)["dayOfWeek"];
    startDate: string;
    endDate?: string | null;
  }) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `${opts.label} ${uniqueId()}`,
        orgId: opts.aoId,
        locationId: opts.locationId,
        dayOfWeek: opts.dayOfWeek,
        startTime: "0530",
        isActive: true,
        highlight: false,
        startDate: opts.startDate,
        endDate: opts.endDate ?? null,
        isPrivate: false,
      })
      .returning();

    if (!event) throw new Error(`Failed to create event: ${opts.label}`);
    createdEventIds.push(event.id);
    return event;
  };

  /**
   * Builds a region + AO + location carrying one event per date-window case, so a
   * single query response can be asserted against every boundary at once.
   *
   * `today` is the database's `CURRENT_DATE`; the window is
   * `start_date <= today + 6 days AND (end_date IS NULL OR end_date >= today)`.
   */
  const createDateWindowFixture = async () => {
    const today = await getDbCurrentDate();

    const region = await createTestRegion();
    if (!region) throw new Error("Failed to create test region");
    const ao = await createTestAO(region.id);
    if (!ao) throw new Error("Failed to create test AO");
    const location = await createTestLocation(region.id);
    if (!location) throw new Error("Failed to create test location");

    const base = { aoId: ao.id, locationId: location.id } as const;

    // Included: starts exactly on the last day of the six-day window.
    const startsOnBoundary = await createDatedEvent({
      ...base,
      label: "Starts On Boundary",
      dayOfWeek: "monday",
      startDate: shiftDays(today, 6),
    });

    // Excluded: starts one day past the six-day window.
    const startsPastBoundary = await createDatedEvent({
      ...base,
      label: "Starts Past Boundary",
      dayOfWeek: "tuesday",
      startDate: shiftDays(today, 7),
    });

    // Included: ends today — the last day it should still be shown.
    const endsToday = await createDatedEvent({
      ...base,
      label: "Ends Today",
      dayOfWeek: "wednesday",
      startDate: shiftDays(today, -30),
      endDate: today,
    });

    // Excluded: ended yesterday.
    const endedYesterday = await createDatedEvent({
      ...base,
      label: "Ended Yesterday",
      dayOfWeek: "thursday",
      startDate: shiftDays(today, -30),
      endDate: shiftDays(today, -1),
    });

    // Included: open-ended recurring event with no end date.
    const noEndDate = await createDatedEvent({
      ...base,
      label: "No End Date",
      dayOfWeek: "friday",
      startDate: shiftDays(today, -30),
      endDate: null,
    });

    return {
      today,
      location,
      included: [startsOnBoundary, endsToday, noEndDate],
      excluded: [startsPastBoundary, endedYesterday],
    };
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

        // Event tuple index 5 is aoName
        const aoNames = events.map((e) => e[5] as string);
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
        const aoNames = events.map((e) => e[5] as string);
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

    it("should include a series-linked instance whose location differs from its parent event's location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const parentLocation = await createTestLocation(region.id);
      const awayLocation = await createTestLocation(region.id);
      if (!parentLocation || !awayLocation)
        throw new Error("Failed to create test locations");

      // Parent series has a concrete location, so neither the exception branch
      // nor the null-parent-location branch of the predicate applies here.
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Anchored Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: parentLocation.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (!event) throw new Error("Failed to create anchored series event");
      createdEventIds.push(event.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      await db.insert(schema.eventInstances).values({
        name: `Away Instance ${uniqueId()}`,
        orgId: ao.id,
        seriesId: event.id,
        locationId: awayLocation.id,
        startDate,
        startTime: "0600",
        endTime: "0700",
        isActive: true,
        highlight: false,
        isPrivate: false,
        // No seriesException — the location difference alone must qualify it.
        seriesException: null,
      });

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      const awayInstance = result.find(
        (instance) =>
          instance.seriesId === event.id &&
          instance.locationId === awayLocation.id,
      );

      expect(awayInstance).toEqual(
        expect.objectContaining({
          seriesId: event.id,
          locationId: awayLocation.id,
          lat: awayLocation.latitude,
          lon: awayLocation.longitude,
          seriesException: null,
        }),
      );
    });

    it("should exclude a series-linked instance sitting at its parent event's location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const parentLocation = await createTestLocation(region.id);
      if (!parentLocation) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Same Location Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: parentLocation.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (!event) throw new Error("Failed to create series event");
      createdEventIds.push(event.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      await db.insert(schema.eventInstances).values({
        name: `Ordinary Instance ${uniqueId()}`,
        orgId: ao.id,
        seriesId: event.id,
        locationId: parentLocation.id,
        startDate,
        startTime: "0530",
        isActive: true,
        highlight: false,
        isPrivate: false,
        seriesException: null,
      });

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      // An unremarkable occurrence at the series' own location is already drawn
      // from the series itself, so widening the predicate must not start
      // returning every instance in the window.
      const ordinary = result.find(
        (instance) =>
          instance.seriesId === event.id &&
          instance.locationId === parentLocation.id,
      );

      expect(ordinary).toBeUndefined();
    });

    it("should include a locationless series exception so it can flag its parent's status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const parentLocation = await createTestLocation(region.id);
      if (!parentLocation) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Cancelled Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: parentLocation.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (!event) throw new Error("Failed to create series event");
      createdEventIds.push(event.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      // A closure carries no location of its own — there is nowhere for it to
      // happen. It still has to reach the client, which uses it to mark the
      // parent series closed without drawing a pin.
      await db.insert(schema.eventInstances).values({
        name: `Cancelled Instance ${uniqueId()}`,
        orgId: ao.id,
        seriesId: event.id,
        locationId: null,
        startDate,
        isActive: true,
        highlight: false,
        isPrivate: false,
        seriesException: "closed",
      });

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      const closure = result.find((instance) => instance.seriesId === event.id);

      expect(closure).toEqual(
        expect.objectContaining({
          seriesId: event.id,
          seriesException: "closed",
          locationId: null,
          // No coordinates, so the client's merge step skips marker creation.
          lat: null,
          lon: null,
          fullAddress: null,
        }),
      );
    });

    // Regression: the sibling "locationless series exception" test above passes
    // on the seriesException arm of the predicate and never reaches the location
    // comparison. This case has NO exception and a *located* parent, so it lands
    // squarely on that comparison — where `ne(NULL, parentLocationId)` yields SQL
    // NULL rather than true, silently dropping the row until an explicit
    // isNull(eventInstances.locationId) arm was added.
    it("should include a locationless instance of a located series when no exception applies", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const parentLocation = await createTestLocation(region.id);
      if (!parentLocation) throw new Error("Failed to create test location");

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Located Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: parentLocation.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: false,
        })
        .returning();

      if (!event) throw new Error("Failed to create located series event");
      createdEventIds.push(event.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      await db.insert(schema.eventInstances).values({
        name: `Locationless Instance ${uniqueId()}`,
        orgId: ao.id,
        seriesId: event.id,
        // The occurrence itself has no location — this is the NULL side that
        // made the parent-location comparison unknown.
        locationId: null,
        startDate,
        startTime: "0600",
        endTime: "0700",
        isActive: true,
        highlight: false,
        isPrivate: false,
        seriesException: null,
      });

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      const locationless = result.find(
        (instance) => instance.seriesId === event.id,
      );

      expect(locationless).toEqual(
        expect.objectContaining({
          seriesId: event.id,
          locationId: null,
          seriesException: null,
          // No coordinates, so the client's merge step skips marker creation —
          // same contract as the locationless exception case above.
          lat: null,
          lon: null,
        }),
      );
    });

    it("should exclude an instance whose location is inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const [inactiveLocation] = await db
        .insert(schema.locations)
        .values({
          name: `Retired Location ${uniqueId()}`,
          orgId: region.id,
          isActive: false,
          latitude: 35.5,
          longitude: -80.5,
        })
        .returning();

      if (!inactiveLocation)
        throw new Error("Failed to create inactive location");
      createdLocationIds.push(inactiveLocation.id);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      // Standalone (no seriesId) so it clears the outer predicate, and flagged
      // as an exception too — the only reason to exclude it is the inactive
      // location, which the LEFT JOIN must not have stopped enforcing.
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Instance At Retired Location ${uniqueId()}`,
          orgId: ao.id,
          locationId: inactiveLocation.id,
          startDate,
          isActive: true,
          highlight: false,
          isPrivate: false,
          seriesException: "closed",
        })
        .returning();

      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      expect(
        result.find((returned) => returned.id === instance.id),
      ).toBeUndefined();
    });

    // A one-off instance is the row admins soft-delete (`eventInstance.delete`
    // flips isActive) or hide, so these two flags carry the whole weight of
    // "this occurrence is gone" — nothing upstream is also false to catch it.
    // Both cases are standalone, which clears the outer predicate on the
    // seriesId-is-null arm and leaves the instance's own flag as the sole
    // disqualifier.
    describe.each([
      { label: "deactivated", flags: { isActive: false, isPrivate: false } },
      { label: "private", flags: { isActive: true, isPrivate: true } },
    ])("instance is $label", ({ label, flags }) => {
      it("should exclude it from upcoming instances", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create test AO");

        const location = await createTestLocation(region.id);
        if (!location) throw new Error("Failed to create test location");

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const startDate = tomorrow.toISOString().slice(0, 10);

        // Active AO, active region, active location, in-window date, no parent
        // series to inherit anything from.
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Hidden One-Off ${label} ${uniqueId()}`,
            orgId: ao.id,
            seriesId: null,
            locationId: location.id,
            startDate,
            startTime: "0600",
            endTime: "0700",
            highlight: false,
            ...flags,
          })
          .returning();

        if (!instance) throw new Error("Failed to create event instance");

        const client = createTestClient();
        const result = await client.map.location.upcomingInstances();

        expect(
          result.find((returned) => returned.id === instance.id),
        ).toBeUndefined();
      });
    });

    // Guards the pair above: without it, a fixture that failed some *other*
    // predicate would make them pass for the wrong reason.
    it("should include the same one-off when it is active and public", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Visible One-Off ${uniqueId()}`,
          orgId: ao.id,
          seriesId: null,
          locationId: location.id,
          startDate,
          startTime: "0600",
          endTime: "0700",
          highlight: false,
          isActive: true,
          isPrivate: false,
        })
        .returning();

      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      expect(result.find((returned) => returned.id === instance.id)).toEqual(
        expect.objectContaining({
          id: instance.id,
          seriesId: null,
          locationId: location.id,
        }),
      );
    });
    // A series' visibility and retirement are not copied down onto its
    // instances, so an instance can stay active and public after its parent is
    // hidden. It must still inherit the parent's state here, or a hidden
    // workout reappears through markers, details, and pin statuses.
    describe.each([
      { label: "private", parent: { isPrivate: true, isActive: true } },
      { label: "inactive", parent: { isPrivate: false, isActive: false } },
    ])("parent series is $label", ({ label, parent }) => {
      it("should exclude an active public instance of that series", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create test AO");

        const parentLocation = await createTestLocation(region.id);
        if (!parentLocation) throw new Error("Failed to create test location");

        const [event] = await db
          .insert(schema.events)
          .values({
            name: `Hidden Series ${label} ${uniqueId()}`,
            orgId: ao.id,
            locationId: parentLocation.id,
            dayOfWeek: "monday",
            startTime: "0530",
            highlight: false,
            startDate: "2026-01-01",
            ...parent,
          })
          .returning();

        if (!event) throw new Error("Failed to create hidden series event");
        createdEventIds.push(event.id);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const startDate = tomorrow.toISOString().slice(0, 10);

        // The instance's own flags say "show me", and the exception clears the
        // outer predicate — the parent's state is the only disqualifier.
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Orphaned Instance ${label} ${uniqueId()}`,
            orgId: ao.id,
            seriesId: event.id,
            locationId: parentLocation.id,
            startDate,
            startTime: "0600",
            endTime: "0700",
            isActive: true,
            highlight: false,
            isPrivate: false,
            seriesException: "closed",
          })
          .returning();

        if (!instance) throw new Error("Failed to create event instance");

        const client = createTestClient();
        const result = await client.map.location.upcomingInstances();

        expect(
          result.find((returned) => returned.id === instance.id),
        ).toBeUndefined();
      });
    });

    it("should exclude a qualifying instance whose region is inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      // Standalone and public, AO still active — the retired region is the
      // only reason this must not become a public marker or pin status.
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Instance In Retired Region ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          startDate,
          startTime: "0600",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();

      if (!instance) throw new Error("Failed to create event instance");

      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, region.id));

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      expect(
        result.find((returned) => returned.id === instance.id),
      ).toBeUndefined();
    });

    it("should exclude a qualifying instance whose area is inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const area = await createTestArea();
      if (!area) throw new Error("Failed to create test area");

      const region = await createTestRegion({ parentId: area.id });
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString().slice(0, 10);

      // Deleting an area does not cascade below it, so the AO and its region
      // both stay active — the retired grandparent is the only reason this
      // instance must not surface as a public marker or pin status.
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Instance In Retired Area ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          startDate,
          startTime: "0600",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();

      if (!instance) throw new Error("Failed to create event instance");

      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, area.id));

      const client = createTestClient();
      const result = await client.map.location.upcomingInstances();

      expect(
        result.find((returned) => returned.id === instance.id),
      ).toBeUndefined();
    });
  });

  /**
   * The date window (`withinCurrentEventDateWindow` in location.ts) gates both
   * eventsAndLocations and locationWorkout. These cases pin its boundaries so a
   * regression can't silently hide upcoming workouts or keep ended ones on the
   * map.
   */
  describe("current event date window", () => {
    it("should include only in-window events in eventsAndLocations", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const fixture = await createDateWindowFixture();

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      // Map data format: [locationId, name, logo, lat, lon, fullAddress, events[]]
      const locationData = result.find(
        (loc: [number, ...unknown[]]) => loc[0] === fixture.location.id,
      );
      expect(locationData).toBeDefined();

      // Events are at tuple index 6; event tuple index 0 is the event id.
      const events = locationData![6] as [number, ...unknown[]][];
      const eventIds = events.map((event) => event[0]);

      expect(eventIds.sort()).toEqual(
        fixture.included.map((event) => event.id).sort(),
      );
      for (const excluded of fixture.excluded) {
        expect(eventIds).not.toContain(excluded.id);
      }
    });

    it("should include only in-window events in locationWorkout", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const fixture = await createDateWindowFixture();

      const client = createTestClient();
      const result = await client.map.location.locationWorkout({
        locationId: fixture.location.id,
      });

      expect(result.location).not.toBeNull();
      const eventIds = result.location!.events.map((event) => event.id);

      expect(eventIds.sort()).toEqual(
        fixture.included.map((event) => event.id).sort(),
      );
      for (const excluded of fixture.excluded) {
        expect(eventIds).not.toContain(excluded.id);
      }
    });

    it("should return endDate on locationWorkout events so the panel can show it", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const today = await getDbCurrentDate();
      const endDate = shiftDays(today, 30);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      const dated = await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Dated Event",
        dayOfWeek: "monday",
        startDate: shiftDays(today, -30),
        endDate,
      });
      const openEnded = await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Open Ended Event",
        dayOfWeek: "tuesday",
        startDate: shiftDays(today, -30),
        endDate: null,
      });

      const client = createTestClient();
      const result = await client.map.location.locationWorkout({
        locationId: location.id,
      });

      const events = result.location?.events ?? [];
      expect(events.find((e) => e.id === dated.id)?.endDate).toBe(endDate);
      // Open-ended events must report null, not the sibling's date.
      expect(events.find((e) => e.id === openEnded.id)?.endDate).toBeNull();
    });

    it("should drop a location whose only event has already ended", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const today = await getDbCurrentDate();

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Only Ended Event",
        dayOfWeek: "monday",
        startDate: shiftDays(today, -30),
        endDate: shiftDays(today, -1),
      });

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      // The INNER JOIN on the date window must leave no orphaned pin behind.
      expect(
        result.find((loc: [number, ...unknown[]]) => loc[0] === location.id),
      ).toBeUndefined();

      const workout = await client.map.location.locationWorkout({
        locationId: location.id,
      });
      expect(workout.location).toBeNull();
      // A stale link is a routine case, not a missing-coordinates fault: the
      // message is rendered verbatim to the user, so it must not leak the
      // internal lat/lng diagnostic.
      expect(workout.message).toBe("This workout is no longer scheduled.");
      expect(workout.message).not.toContain("Lat/lng");
    });

    it("should drop a location whose only event starts past the six-day window", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const today = await getDbCurrentDate();

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Only Upcoming Event",
        dayOfWeek: "monday",
        startDate: shiftDays(today, 7),
      });

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      expect(
        result.find((loc: [number, ...unknown[]]) => loc[0] === location.id),
      ).toBeUndefined();

      const workout = await client.map.location.locationWorkout({
        locationId: location.id,
      });
      expect(workout.location).toBeNull();
      expect(workout.message).toBe("This workout is no longer scheduled.");
      expect(workout.message).not.toContain("Lat/lng");
    });

    it("should hide markers and workout details when the region is inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const today = await getDbCurrentDate();

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Event In Retired Region",
        dayOfWeek: "monday",
        startDate: shiftDays(today, -1),
      });

      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, region.id));

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      expect(
        result.find((loc: [number, ...unknown[]]) => loc[0] === location.id),
      ).toBeUndefined();

      const workout = await client.map.location.locationWorkout({
        locationId: location.id,
      });
      expect(workout.location).toBeNull();
      expect(workout.message).toBe("This workout is no longer scheduled.");
    });

    it("should hide markers and workout details when the area is inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const today = await getDbCurrentDate();

      const area = await createTestArea();
      if (!area) throw new Error("Failed to create test area");
      const region = await createTestRegion({ parentId: area.id });
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const location = await createTestLocation(region.id);
      if (!location) throw new Error("Failed to create test location");

      await createDatedEvent({
        aoId: ao.id,
        locationId: location.id,
        label: "Event In Retired Area",
        dayOfWeek: "monday",
        startDate: shiftDays(today, -1),
      });

      // Only the area is retired; its region and AO stay active.
      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, area.id));

      const client = createTestClient();
      const result = await client.map.location.eventsAndLocations();

      expect(
        result.find((loc: [number, ...unknown[]]) => loc[0] === location.id),
      ).toBeUndefined();

      const workout = await client.map.location.locationWorkout({
        locationId: location.id,
      });
      expect(workout.location).toBeNull();
      expect(workout.message).toBe("This workout is no longer scheduled.");
    });
  });
});
