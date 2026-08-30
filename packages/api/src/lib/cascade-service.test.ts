/**
 * Tests for Cascade Service
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return {
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60000,
      }),
    };
  }),
}));

import { and, eq, gte, inArray, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, getOrCreateF3NationOrg, uniqueId } from "../__tests__/test-utils";
import type { SeriesData } from "./cascade-service";
import {
  createEventInstancesForSeries,
  createEventInstancesForSeriesReturningIds,
  prepareEventInstanceRecords,
  deleteFutureInstancesForSeries,
  isStructuralChange,
  recreateFutureInstances,
  softDeleteFutureInstancesForOrg,
  softDeleteFutureInstancesForSeries,
  softDeleteSeriesForOrg,
  updateFutureInstances,
} from "./cascade-service";

describe("Cascade Service", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdOrgIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up event instances first (FK references events via seriesId)
    for (const eventId of createdEventIds) {
      try {
        // Delete all join rows for instances of this series by resolving
        // instance IDs from the event_instances table.
        const instances = await db
          .select({ id: schema.eventInstances.id })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, eventId));

        for (const instance of instances) {
          await db
            .delete(schema.eventInstancesXEventTypes)
            .where(
              eq(schema.eventInstancesXEventTypes.eventInstanceId, instance.id),
            );
        }
      } catch {
        // ignore
      }
    }
    // Delete event instances by seriesId
    for (const eventId of createdEventIds) {
      try {
        await db
          .delete(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, eventId));
      } catch {
        // ignore
      }
    }
    // Delete events
    for (const eventId of createdEventIds.reverse()) {
      try {
        await db
          .delete(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, eventId));
        await db.delete(schema.events).where(eq(schema.events.id, eventId));
      } catch {
        // ignore
      }
    }
    // Delete event types
    for (const eventTypeId of createdEventTypeIds.reverse()) {
      try {
        await db
          .delete(schema.eventTypes)
          .where(eq(schema.eventTypes.id, eventTypeId));
      } catch {
        // ignore
      }
    }
    // Delete locations
    for (const locationId of createdLocationIds.reverse()) {
      try {
        await db
          .update(schema.events)
          .set({ locationId: null })
          .where(eq(schema.events.locationId, locationId));
        await db
          .delete(schema.locations)
          .where(eq(schema.locations.id, locationId));
      } catch {
        // ignore
      }
    }
    // Delete orgs
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.orgId, orgId));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      } catch {
        // ignore
      }
    }
  }, 30000);

  // --- Helpers ---

  const createTestRegion = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Cascade Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
      })
      .returning();
    if (region) createdOrgIds.push(region.id);
    return region!;
  };

  const createTestAO = async (regionId: number) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Cascade AO ${uniqueId()}`,
        orgType: "ao",
        parentId: regionId,
        isActive: true,
      })
      .returning();
    if (ao) createdOrgIds.push(ao.id);
    return ao!;
  };

  const createTestLocation = async (orgId: number) => {
    const [location] = await db
      .insert(schema.locations)
      .values({
        name: `Cascade Location ${uniqueId()}`,
        orgId,
        isActive: true,
        latitude: 35.5,
        longitude: -80.5,
      })
      .returning();
    if (location) createdLocationIds.push(location.id);
    return location!;
  };

  const createTestEventType = async () => {
    const [eventType] = await db
      .insert(schema.eventTypes)
      .values({
        name: `Cascade EventType ${uniqueId()}`,
        eventCategory: "first_f",
        isActive: true,
      })
      .returning();
    if (eventType) createdEventTypeIds.push(eventType.id);
    return eventType!;
  };

  /** Create a series (event with recurrence pattern) in the DB and return SeriesData */
  const createTestSeries = async (
    aoId: number,
    locationId: number | null,
    overrides?: Partial<SeriesData>,
  ) => {
    const defaults = {
      name: `Cascade Series ${uniqueId()}`,
      orgId: aoId,
      locationId,
      dayOfWeek: "monday" as const,
      startDate: "2026-01-01",
      endDate: null,
      startTime: "0530",
      endTime: "0615",
      recurrencePattern: "weekly" as const,
      recurrenceInterval: 1,
      indexWithinInterval: 1,
      isActive: true,
      isPrivate: false,
      highlight: false,
      description: null,
      meta: null,
    };
    const data = { ...defaults, ...overrides };

    const [event] = await db
      .insert(schema.events)
      .values({
        name: data.name,
        orgId: data.orgId,
        locationId: data.locationId,
        dayOfWeek: data.dayOfWeek,
        startDate: data.startDate,
        endDate: data.endDate,
        startTime: data.startTime,
        endTime: data.endTime,
        recurrencePattern: data.recurrencePattern,
        recurrenceInterval: data.recurrenceInterval,
        indexWithinInterval: data.indexWithinInterval,
        isActive: data.isActive,
        isPrivate: data.isPrivate,
        highlight: data.highlight,
        description: data.description,
        meta: data.meta,
      })
      .returning();

    if (event) createdEventIds.push(event.id);

    const series: SeriesData = {
      id: event!.id,
      ...data,
    };
    return series;
  };

  // --- Pure function tests ---

  describe("isStructuralChange", () => {
    it("should return false when no structural fields change", () => {
      const existing = { name: "old", startTime: "0530" };
      const updated = { name: "new", startTime: "0600" };
      expect(isStructuralChange(existing, updated)).toBe(false);
    });

    it("should return true when dayOfWeek changes", () => {
      expect(
        isStructuralChange({ dayOfWeek: "monday" }, { dayOfWeek: "wednesday" }),
      ).toBe(true);
    });

    it("should return true when recurrencePattern changes", () => {
      expect(
        isStructuralChange(
          { recurrencePattern: "weekly" },
          { recurrencePattern: "monthly" },
        ),
      ).toBe(true);
    });

    it("should return true when recurrenceInterval changes", () => {
      expect(
        isStructuralChange(
          { recurrenceInterval: 1 },
          { recurrenceInterval: 2 },
        ),
      ).toBe(true);
    });

    it("should return true when indexWithinInterval changes", () => {
      expect(
        isStructuralChange(
          { indexWithinInterval: 1 },
          { indexWithinInterval: 2 },
        ),
      ).toBe(true);
    });

    it("should return true when startDate changes", () => {
      expect(
        isStructuralChange(
          { startDate: "2026-01-01" },
          { startDate: "2026-02-01" },
        ),
      ).toBe(true);
    });

    it("should return true when endDate changes", () => {
      expect(
        isStructuralChange(
          { endDate: "2026-12-31" },
          { endDate: "2027-06-30" },
        ),
      ).toBe(true);
    });

    it("should return false when fields are undefined", () => {
      expect(isStructuralChange({ dayOfWeek: "monday" }, {})).toBe(false);
      expect(isStructuralChange({}, { dayOfWeek: "monday" })).toBe(false);
    });
  });

  describe("prepareEventInstanceRecords", () => {
    it("uses legacy weekly defaults for null recurrence fields", () => {
      const records = prepareEventInstanceRecords(
        {
          id: 1,
          orgId: 1,
          locationId: null,
          name: "series",
          description: null,
          startDate: "2026-04-01",
          endDate: "2026-04-15",
          startTime: null,
          endTime: null,
          dayOfWeek: "wednesday",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          isActive: true,
          isPrivate: false,
          highlight: false,
          meta: null,
        },
        4,
        "2026-04-01",
      );

      expect(records.map((record) => record.startDate)).toEqual([
        "2026-04-01",
        "2026-04-08",
        "2026-04-15",
      ]);
    });

    it("returns the same intended rows used by the creation path", () => {
      const records = prepareEventInstanceRecords(
        {
          id: 2,
          orgId: 1,
          locationId: null,
          name: "series",
          description: null,
          startDate: "2026-04-01",
          endDate: "2026-04-30",
          startTime: null,
          endTime: null,
          dayOfWeek: "friday",
          recurrencePattern: "weekly",
          recurrenceInterval: 2,
          indexWithinInterval: 1,
          isActive: true,
          isPrivate: false,
          highlight: false,
          meta: null,
        },
        4,
        "2026-04-01",
      );

      expect(records).toHaveLength(2);
      expect(records.every((record) => record.seriesId === 2)).toBe(true);
    });
  });

  // --- Database integration tests ---

  describe("createEventInstancesForSeries", () => {
    it("should create weekly instances for a series", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      const location = await createTestLocation(region.id);

      const series = await createTestSeries(ao.id, location.id, {
        dayOfWeek: "monday",
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        startDate: "2026-04-01",
        endDate: "2026-06-30",
      });

      const count = await createEventInstancesForSeries(
        db,
        series,
        4,
        "2026-04-01",
      );

      // ~13 Mondays between Apr 1 and Jun 30, 2026
      expect(count).toBeGreaterThanOrEqual(12);
      expect(count).toBeLessThanOrEqual(14);

      // Verify actual instances in DB
      const instances = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      expect(instances.length).toBe(count);
      // All instances should inherit series properties
      for (const inst of instances) {
        expect(inst.name).toBe(series.name);
        expect(inst.orgId).toBe(series.orgId);
        expect(inst.locationId).toBe(series.locationId);
        expect(inst.startTime).toBe(series.startTime);
        expect(inst.endTime).toBe(series.endTime);
        expect(inst.isActive).toBe(true);
        expect(inst.seriesId).toBe(series.id);
      }
    });

    it("should create biweekly instances (interval=2)", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "wednesday",
        recurrencePattern: "weekly",
        recurrenceInterval: 2,
        startDate: "2026-04-01",
        endDate: "2026-06-30",
      });

      const count = await createEventInstancesForSeries(
        db,
        series,
        4,
        "2026-04-01",
      );

      // ~13 Wednesdays / 2 ≈ 6-7
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(8);
    });

    it("should create monthly instances", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      // First Monday of every month
      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "monday",
        recurrencePattern: "monthly",
        recurrenceInterval: 1,
        indexWithinInterval: 1,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });

      const count = await createEventInstancesForSeries(
        db,
        series,
        4,
        "2026-01-01",
      );

      // 12 months => 12 first Mondays
      expect(count).toBe(12);
    });

    it("should return 0 for series without recurrence", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: null,
        recurrencePattern: null,
      });

      const count = await createEventInstancesForSeries(db, series);
      expect(count).toBe(0);
    });

    it("should create event type join rows when eventTypeIds is provided", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      const eventType = await createTestEventType();

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "friday",
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        eventTypeIds: [eventType.id],
      });

      const count = await createEventInstancesForSeries(
        db,
        series,
        4,
        "2026-04-01",
      );

      expect(count).toBeGreaterThan(0);

      // Verify join table entries
      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      const joinRows = await db
        .select()
        .from(schema.eventInstancesXEventTypes)
        .where(eq(schema.eventInstancesXEventTypes.eventTypeId, eventType.id));

      // Every instance should have an event type association
      const instanceIds = new Set(instances.map((i) => i.id));
      const joinInstanceIds = joinRows
        .filter((j) => instanceIds.has(j.eventInstanceId))
        .map((j) => j.eventInstanceId);

      expect(joinInstanceIds.length).toBe(instances.length);
    });

    it("returns created IDs and associates every ID with each event type", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      const firstType = await createTestEventType();
      const secondType = await createTestEventType();
      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "friday",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        eventTypeIds: [firstType.id, secondType.id],
      });

      const ids = await createEventInstancesForSeriesReturningIds(
        db,
        series,
        4,
        "2026-04-01",
      );
      const joins = await db
        .select()
        .from(schema.eventInstancesXEventTypes)
        .where(inArray(schema.eventInstancesXEventTypes.eventInstanceId, ids));

      expect(ids.length).toBeGreaterThan(0);
      expect(joins).toHaveLength(ids.length * 2);
      expect(new Set(joins.map((join) => join.eventInstanceId)).size).toBe(
        ids.length,
      );
    });

    it("should not create instances past the endDate", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "monday",
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        startDate: "2026-04-01",
        endDate: "2026-04-15",
      });

      const count = await createEventInstancesForSeries(
        db,
        series,
        4,
        "2026-04-01",
      );

      // Only 2-3 Mondays in Apr 1-15 range (Apr 6, Apr 13)
      expect(count).toBeLessThanOrEqual(3);

      const instances = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      for (const inst of instances) {
        expect(inst.startDate <= "2026-04-15").toBe(true);
      }
    });
  });

  describe("softDeleteSeriesForOrg", () => {
    it("should soft delete all series for an org", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      // Create two series for this org
      await createTestSeries(ao.id, null, {
        recurrencePattern: "weekly",
        dayOfWeek: "monday",
      });
      await createTestSeries(ao.id, null, {
        recurrencePattern: "weekly",
        dayOfWeek: "tuesday",
      });

      const deletedCount = await softDeleteSeriesForOrg(db, ao.id);
      expect(deletedCount).toBe(2);

      // Verify they're inactive
      const events = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.orgId, ao.id));

      for (const event of events) {
        expect(event.isActive).toBe(false);
      }
    });

    it("should not affect events without recurrence patterns", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      // Create a non-recurring event
      const [nonRecurring] = await db
        .insert(schema.events)
        .values({
          name: `NonRecurring ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startDate: "2026-01-01",
          isActive: true,
          highlight: false,
          isPrivate: false,
          recurrencePattern: null,
        })
        .returning();
      if (nonRecurring) createdEventIds.push(nonRecurring.id);

      const deletedCount = await softDeleteSeriesForOrg(db, ao.id);
      expect(deletedCount).toBe(0);

      // Non-recurring event should still be active
      const [event] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, nonRecurring!.id));
      expect(event!.isActive).toBe(true);
    });
  });

  describe("softDeleteFutureInstancesForOrg", () => {
    it("should soft delete future instances for an org", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "monday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const deletedCount = await softDeleteFutureInstancesForOrg(
        db,
        ao.id,
        "2026-04-15",
      );

      expect(deletedCount).toBeGreaterThan(0);

      // Instances before cutoff date should still be active
      const activeInstances = await db
        .select()
        .from(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.orgId, ao.id),
            eq(schema.eventInstances.isActive, true),
          ),
        );

      for (const inst of activeInstances) {
        expect(inst.startDate < "2026-04-15").toBe(true);
      }
    });
  });

  describe("softDeleteFutureInstancesForSeries", () => {
    it("should soft delete future instances for a specific series", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "wednesday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const totalBefore = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      const deletedCount = await softDeleteFutureInstancesForSeries(
        db,
        series.id,
        "2026-05-01",
      );

      expect(deletedCount).toBeGreaterThan(0);
      expect(deletedCount).toBeLessThan(totalBefore.length);

      // Check remaining active instances are all before the cutoff
      const stillActive = await db
        .select()
        .from(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.seriesId, series.id),
            eq(schema.eventInstances.isActive, true),
          ),
        );

      for (const inst of stillActive) {
        expect(inst.startDate < "2026-05-01").toBe(true);
      }
    });
  });

  describe("deleteFutureInstancesForSeries", () => {
    it("should hard delete future instances for a series", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "thursday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const totalBefore = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      const deletedCount = await deleteFutureInstancesForSeries(
        db,
        series.id,
        "2026-05-01",
      );

      expect(deletedCount).toBeGreaterThan(0);

      // Remaining instances should only be pre-cutoff
      const remaining = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      expect(remaining.length).toBe(totalBefore.length - deletedCount);
      for (const inst of remaining) {
        expect(inst.startDate < "2026-05-01").toBe(true);
      }
    });
  });

  describe("updateFutureInstances", () => {
    it("should update non-structural fields on future instances", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      const location = await createTestLocation(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "tuesday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      // Update the series data with new non-structural fields
      const updatedSeries: SeriesData = {
        ...series,
        name: "Updated Series Name",
        description: "New description",
        locationId: location.id,
        startTime: "0600",
        endTime: "0700",
        isPrivate: true,
        highlight: true,
      };

      const updatedCount = await updateFutureInstances(
        db,
        updatedSeries,
        "2026-04-15",
      );

      expect(updatedCount).toBeGreaterThan(0);

      // Verify the updates
      const updatedInstances = await db
        .select()
        .from(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.seriesId, series.id),
            gte(schema.eventInstances.startDate, "2026-04-15"),
          ),
        );

      for (const inst of updatedInstances) {
        expect(inst.name).toBe("Updated Series Name");
        expect(inst.description).toBe("New description");
        expect(inst.locationId).toBe(location.id);
        expect(inst.startTime).toBe("0600");
        expect(inst.endTime).toBe("0700");
        expect(inst.isPrivate).toBe(true);
        expect(inst.highlight).toBe(true);
      }
    });

    it("should update event type associations for future instances", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      const eventType1 = await createTestEventType();
      const eventType2 = await createTestEventType();

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "friday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        eventTypeIds: [eventType1.id],
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      // Change event type
      const updatedSeries: SeriesData = {
        ...series,
        eventTypeIds: [eventType2.id],
      };

      await updateFutureInstances(db, updatedSeries, "2026-04-01");

      // Verify new event type associations
      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      for (const inst of instances) {
        const joinRows = await db
          .select()
          .from(schema.eventInstancesXEventTypes)
          .where(eq(schema.eventInstancesXEventTypes.eventInstanceId, inst.id));
        expect(joinRows.length).toBe(1);
        expect(joinRows[0]!.eventTypeId).toBe(eventType2.id);
      }
    });

    it("should return 0 when there are no future instances", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "monday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-04-15",
      });

      // Create instances in the past (won't match a far-future cutoff)
      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const updatedCount = await updateFutureInstances(
        db,
        series,
        "2099-01-01",
      );
      expect(updatedCount).toBe(0);
    });
  });

  describe("recreateFutureInstances", () => {
    it("should delete and recreate instances for structural changes", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "monday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-06-30",
      });

      // Create initial instances
      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const beforeInstances = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      // Recreate with a structural change (e.g. changed dayOfWeek)
      const updatedSeries: SeriesData = {
        ...series,
        dayOfWeek: "wednesday",
      };

      const result = await recreateFutureInstances(
        db,
        updatedSeries,
        "2026-04-01",
        4,
      );

      expect(result.deleted).toBe(beforeInstances.length);
      expect(result.created).toBeGreaterThan(0);

      // Verify new instances exist and are all on Wednesdays
      const newInstances = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      expect(newInstances.length).toBe(result.created);
      for (const inst of newInstances) {
        const date = new Date(inst.startDate + "T12:00:00Z");
        expect(date.getUTCDay()).toBe(3); // Wednesday = 3
      }
    });

    it("should preserve pre-cutoff instances and recreate post-cutoff", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      const series = await createTestSeries(ao.id, null, {
        dayOfWeek: "tuesday",
        recurrencePattern: "weekly",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
      });

      await createEventInstancesForSeries(db, series, 4, "2026-04-01");

      const allBefore = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      const preCutoff = allBefore.filter((i) => i.startDate < "2026-05-01");

      const result = await recreateFutureInstances(db, series, "2026-05-01", 4);

      // Pre-cutoff instances should still exist
      const remaining = await db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));

      const remainingPreCutoff = remaining.filter(
        (i) => i.startDate < "2026-05-01",
      );

      expect(remainingPreCutoff.length).toBe(preCutoff.length);
      expect(result.deleted).toBeGreaterThan(0);
      expect(result.created).toBeGreaterThan(0);
    });
  });
});
