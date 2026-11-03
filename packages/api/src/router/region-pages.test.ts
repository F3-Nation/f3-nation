/**
 * Tests for the public region pages router (apps/region-pages).
 *
 * Requires TEST_DATABASE_URL; the global setup resets and seeds it.
 */

import { eq, schema } from "@acme/db";
import kebabCase from "lodash/kebabCase";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanup,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import { clearMapDataCache } from "../lib/map-data-cache";

describe("Region Pages Router", () => {
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdOrgIds: number[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    clearMapDataCache();
    // Anonymous caller: these are public reads.
    await mockAuthWithSession(null);
  });

  afterAll(async () => {
    for (const id of createdEventIds.reverse()) await cleanup.event(id);
    for (const id of createdEventTypeIds) await cleanup.eventType(id);
    for (const id of createdLocationIds) await cleanup.location(id);
    for (const id of createdOrgIds.reverse()) await cleanup.org(id);
  });

  const createOrg = async (
    values: Pick<typeof schema.orgs.$inferInsert, "orgType" | "parentId"> &
      Partial<typeof schema.orgs.$inferInsert>,
  ) => {
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `RP ${values.orgType} ${uniqueId()}`,
        isActive: true,
        ...values,
      })
      .returning();
    if (!org) throw new Error("Failed to create org");
    createdOrgIds.push(org.id);
    return org;
  };

  const createLocation = async (
    orgId: number,
    values: Partial<typeof schema.locations.$inferInsert> = {},
  ) => {
    const [location] = await db
      .insert(schema.locations)
      .values({
        name: `RP Location ${uniqueId()}`,
        orgId,
        isActive: true,
        latitude: 35.1,
        longitude: -106.6,
        addressStreet: "1 Main St",
        addressCity: "Albuquerque",
        addressState: "NM",
        addressZip: "87111",
        addressCountry: "US",
        ...values,
      })
      .returning();
    if (!location) throw new Error("Failed to create location");
    createdLocationIds.push(location.id);
    return location;
  };

  const createEventType = async () => {
    const [eventType] = await db
      .insert(schema.eventTypes)
      .values({ name: `RP Type ${uniqueId()}`, eventCategory: "first_f" })
      .returning();
    if (!eventType) throw new Error("Failed to create event type");
    createdEventTypeIds.push(eventType.id);
    return eventType;
  };

  const createEvent = async (
    aoId: number,
    locationId: number,
    eventTypeIds: number[],
    values: Partial<typeof schema.events.$inferInsert> = {},
  ) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `RP Workout ${uniqueId()}`,
        orgId: aoId,
        locationId,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        isActive: true,
        highlight: false,
        isPrivate: false,
        startDate: "2020-01-01",
        ...values,
      })
      .returning();
    if (!event) throw new Error("Failed to create event");
    createdEventIds.push(event.id);
    if (eventTypeIds.length) {
      await db.insert(schema.eventsXEventTypes).values(
        eventTypeIds.map((eventTypeId) => ({
          eventId: event.id,
          eventTypeId,
        })),
      );
    }
    return event;
  };

  /** Region with one AO, one location and one event type. */
  const createRegionFixture = async () => {
    const nation = await getOrCreateF3NationOrg();
    const region = await createOrg({
      orgType: "region",
      parentId: nation.id,
      twitter: "@f3test",
      email: "region@example.com",
    });
    const ao = await createOrg({ orgType: "ao", parentId: region.id });
    const location = await createLocation(region.id);
    const eventType = await createEventType();
    return { nation, region, ao, location, eventType };
  };

  describe("region", () => {
    it("returns the region and its public workouts by slug", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      const event = await createEvent(ao.id, location.id, [eventType.id]);

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.region).toMatchObject({
        id: String(region.id),
        name: region.name,
        slug: kebabCase(region.name),
        twitter: "https://x.com/f3test",
        email: "region@example.com",
        city: "Albuquerque",
        state: "NM",
        workoutCount: 1,
      });
      expect(result?.workouts).toEqual([
        expect.objectContaining({
          id: String(event.id),
          regionId: String(region.id),
          time: "5:30 AM - 6:15 AM",
          type: eventType.name,
          types: [eventType.name],
          group: "monday",
          location: "1 Main St, Albuquerque, NM, 87111, US",
        }),
      ]);
    });

    it("returns null for an unknown slug", async () => {
      const client = createTestClient();
      expect(
        await client.regionPages.region({ slug: `no-such-${uniqueId()}` }),
      ).toBeNull();
    });

    it("returns null for an inactive region", async () => {
      const { region } = await createRegionFixture();
      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, region.id));

      const client = createTestClient();
      expect(
        await client.regionPages.region({ slug: kebabCase(region.name) }),
      ).toBeNull();
    });

    it("hides private, inactive, ended, typeless and dayless workouts", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      const visible = await createEvent(ao.id, location.id, [eventType.id]);
      await createEvent(ao.id, location.id, [eventType.id], {
        isPrivate: true,
      });
      await createEvent(ao.id, location.id, [eventType.id], {
        isActive: false,
      });
      await createEvent(ao.id, location.id, [eventType.id], {
        endDate: "2020-06-01",
      });
      await createEvent(ao.id, location.id, []);
      await createEvent(ao.id, location.id, [eventType.id], {
        dayOfWeek: null,
      });
      const inactiveAo = await createOrg({
        orgType: "ao",
        parentId: region.id,
        isActive: false,
      });
      await createEvent(inactiveAo.id, location.id, [eventType.id]);
      const closedLocation = await createLocation(region.id, {
        isActive: false,
      });
      await createEvent(ao.id, closedLocation.id, [eventType.id]);

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.workouts.map((w) => w.id)).toEqual([String(visible.id)]);
    });

    it("collapses duplicate schedules to the newest event", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      const name = `RP Dup ${uniqueId()}`;
      await createEvent(ao.id, location.id, [eventType.id], { name });
      const newer = await createEvent(ao.id, location.id, [eventType.id], {
        name,
      });

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.workouts.map((w) => w.id)).toEqual([String(newer.id)]);
    });
    it("returns one workout per series with every event type, ordered by id", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      const second = await createEventType();
      const event = await createEvent(ao.id, location.id, [
        second.id,
        eventType.id,
      ]);

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.workouts).toHaveLength(1);
      expect(result?.workouts[0]).toMatchObject({
        id: String(event.id),
        type: eventType.name,
        types: [eventType.name, second.name],
      });
      expect(result?.region.workoutCount).toBe(1);
    });

    it("hides series that start after the current window", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      const current = await createEvent(ao.id, location.id, [eventType.id]);
      await createEvent(ao.id, location.id, [eventType.id], {
        startDate: "2999-01-01",
      });

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.workouts.map((w) => w.id)).toEqual([String(current.id)]);
    });

    it("only counts AOs whose parent is the region itself", async () => {
      const { region, location, eventType } = await createRegionFixture();
      const area = await createOrg({ orgType: "area", parentId: region.id });
      const nestedAo = await createOrg({ orgType: "ao", parentId: area.id });
      await createEvent(nestedAo.id, location.id, [eventType.id]);

      const client = createTestClient();
      const result = await client.regionPages.region({
        slug: kebabCase(region.name),
      });

      expect(result?.workouts).toEqual([]);
    });
  });

  describe("slug collisions", () => {
    it("lists and resolves only the lowest-id region for a shared slug", async () => {
      const nation = await getOrCreateF3NationOrg();
      const base = `RP Collide ${uniqueId()}`;
      const first = await createOrg({
        orgType: "region",
        parentId: nation.id,
        name: base,
      });
      const second = await createOrg({
        orgType: "region",
        parentId: nation.id,
        name: `${base}!`,
      });
      const slug = kebabCase(base);
      expect(kebabCase(second.name)).toBe(slug);

      const client = createTestClient();
      const listed = (await client.regionPages.regions()).filter(
        (r) => r.slug === slug,
      );
      const resolved = await client.regionPages.region({ slug });

      expect(listed.map((r) => r.id)).toEqual([String(first.id)]);
      expect(resolved?.region.id).toBe(String(first.id));
    });
  });

  describe("regions", () => {
    it("lists active regions with workout counts and hides inactive ones", async () => {
      const { region, ao, location, eventType } = await createRegionFixture();
      await createEvent(ao.id, location.id, [eventType.id]);
      await createEvent(ao.id, location.id, [eventType.id], {
        dayOfWeek: "wednesday",
      });
      const nation = await getOrCreateF3NationOrg();
      const inactive = await createOrg({
        orgType: "region",
        parentId: nation.id,
        isActive: false,
      });

      const client = createTestClient();
      const regions = await client.regionPages.regions();

      expect(regions.find((r) => r.id === String(region.id))).toMatchObject({
        workoutCount: 2,
        city: "Albuquerque",
      });
      expect(regions.some((r) => r.id === String(inactive.id))).toBe(false);

      // Only regions: an active AO or area is neither listed nor resolvable.
      const area = await createOrg({ orgType: "area", parentId: nation.id });
      clearMapDataCache();
      const listed = await client.regionPages.regions();
      for (const org of [ao, area]) {
        expect(listed.some((r) => r.id === String(org.id))).toBe(false);
        expect(
          await client.regionPages.region({ slug: kebabCase(org.name) }),
        ).toBeNull();
      }

      const names = regions.map((r) => r.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("hides regions under an inactive ancestor", async () => {
      const nation = await getOrCreateF3NationOrg();
      const area = await createOrg({
        orgType: "area",
        parentId: nation.id,
        isActive: false,
      });
      const region = await createOrg({ orgType: "region", parentId: area.id });

      const client = createTestClient();
      const regions = await client.regionPages.regions();

      expect(regions.some((r) => r.id === String(region.id))).toBe(false);
    });
  });
});
