/**
 * Tests for Event Instance Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import type * as apiLogger from "../logger";
import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../logger", async (importOriginal) => ({
  ...(await importOriginal<typeof apiLogger>()),
  logWarn: vi.fn(),
}));

import { eq, schema } from "@acme/db";
import type { SeriesException } from "@acme/shared/app/enums";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { logWarn } from "../logger";
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
  const createdEventTagIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdSlackSpaceIds: number[] = [];

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
    for (const eventTagId of createdEventTagIds.reverse()) {
      try {
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
        await db
          .delete(schema.orgsXSlackSpaces)
          .where(eq(schema.orgsXSlackSpaces.orgId, orgId));
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const slackSpaceId of createdSlackSpaceIds.reverse()) {
      try {
        await db
          .delete(schema.orgsXSlackSpaces)
          .where(eq(schema.orgsXSlackSpaces.slackSpaceId, slackSpaceId));
        await db
          .delete(schema.slackSpaces)
          .where(eq(schema.slackSpaces.id, slackSpaceId));
      } catch {
        // Ignore errors during cleanup
      }
    }
  }, 30000); // 30 second timeout for cleanup

  // Helper to create a test region
  const createTestRegion = async (options?: { isActive?: boolean }) => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: options?.isActive ?? true,
      })
      .returning();

    if (region) {
      createdOrgIds.push(region.id);
    }
    return region;
  };

  const createTestNonRegionOrg = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Other Org ${uniqueId()}`,
        orgType: "nation",
        parentId: nationOrg.id,
        isActive: true,
      })
      .returning();

    if (org) {
      createdOrgIds.push(org.id);
    }
    return org;
  };

  // Helper to create a test AO under a region
  const createTestAO = async (
    regionId: number,
    meta?: Record<string, unknown>,
    name?: string,
  ) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: name ?? `Test AO ${uniqueId()}`,
        orgType: "ao",
        parentId: regionId,
        isActive: true,
        meta,
      })
      .returning();

    if (ao) {
      createdOrgIds.push(ao.id);
    }
    return ao;
  };

  const createTestLocation = async (
    orgId: number,
    options?: {
      name?: string;
      addressStreet?: string;
      addressCity?: string;
      addressState?: string;
    },
  ) => {
    const [location] = await db
      .insert(schema.locations)
      .values({
        name: options?.name ?? `Test Location ${uniqueId()}`,
        orgId,
        isActive: true,
        addressStreet: options?.addressStreet ?? null,
        addressCity: options?.addressCity ?? null,
        addressState: options?.addressState ?? null,
      })
      .returning();

    if (location) {
      createdLocationIds.push(location.id);
    }
    return location;
  };

  // Helper to create a test event instance
  const createTestEventInstance = async (
    orgId: number,
    options?: {
      name?: string;
      locationId?: number;
      startDate?: string;
      endDate?: string;
      highlight?: boolean;
      seriesException?: SeriesException;
      startTime?: string | null;
      endTime?: string | null;
      meta?: Record<string, unknown>;
      isActive?: boolean;
      isPrivate?: boolean;
    },
  ) => {
    const [eventInstance] = await db
      .insert(schema.eventInstances)
      .values({
        name: options?.name ?? `Test Event ${uniqueId()}`,
        orgId,
        locationId: options?.locationId ?? null,
        startDate:
          options?.startDate ?? new Date().toISOString().split("T")[0]!,
        endDate: options?.endDate ?? null,
        isActive: options?.isActive ?? true,
        isPrivate: options?.isPrivate ?? false,
        highlight: options?.highlight ?? false,
        seriesException: options?.seriesException ?? null,
        startTime: options?.startTime ?? null,
        endTime: options?.endTime ?? null,
        meta: options?.meta,
      })
      .returning();

    if (eventInstance) {
      createdEventInstanceIds.push(eventInstance.id);
    }
    return eventInstance;
  };

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
      .values({
        name: `Test Event Tag ${uniqueId()}`,
        color: "#FF0000",
        isActive: true,
      })
      .returning();

    if (eventTag) {
      createdEventTagIds.push(eventTag.id);
    }
    return eventTag;
  };

  const linkSlackSettingsToRegion = async (
    regionId: number,
    settings: Record<string, unknown>,
  ) => {
    const [slackSpace] = await db
      .insert(schema.slackSpaces)
      .values({
        teamId: `T${uniqueId()}`,
        workspaceName: `Workspace ${uniqueId()}`,
        settings,
      })
      .returning();

    if (!slackSpace) return null;

    createdSlackSpaceIds.push(slackSpace.id);
    await db.insert(schema.orgsXSlackSpaces).values({
      orgId: regionId,
      slackSpaceId: slackSpace.id,
    });

    return slackSpace;
  };

  const getSlackChannels = (result: unknown) =>
    (result as { slackChannels?: unknown } | null)?.slackChannels;

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

    describe("status filter", () => {
      const seedActiveAndInactive = async () => {
        const region = await createTestRegion();
        if (!region) return null;

        const ao = await createTestAO(region.id);
        if (!ao) return null;

        const active = await createTestEventInstance(ao.id, {
          isActive: true,
        });
        const inactive = await createTestEventInstance(ao.id, {
          isActive: false,
        });
        if (!active || !inactive) return null;

        return { ao, active, inactive };
      };

      it("should default to active only when statuses is omitted", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const seeded = await seedActiveAndInactive();
        if (!seeded) return;

        const client = createTestClient();
        const result = await client.eventInstance.all({
          aoOrgId: seeded.ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        const ids = result.eventInstances.map((e) => e.id);
        expect(ids).toContain(seeded.active.id);
        expect(ids).not.toContain(seeded.inactive.id);
      });

      it("should return both statuses when statuses is empty", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const seeded = await seedActiveAndInactive();
        if (!seeded) return;

        const client = createTestClient();
        const result = await client.eventInstance.all({
          statuses: [],
          aoOrgId: seeded.ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        const ids = result.eventInstances.map((e) => e.id);
        expect(ids).toContain(seeded.active.id);
        expect(ids).toContain(seeded.inactive.id);
      });

      it("should prefer the location name over the address", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create AO");

        const location = await createTestLocation(region.id, {
          name: "The Ballfield",
          addressStreet: "123 Main St",
          addressCity: "Charlotte",
          addressState: "NC",
        });
        if (!location) throw new Error("Failed to create location");

        const instance = await createTestEventInstance(ao.id, {
          locationId: location.id,
        });
        if (!instance) throw new Error("Failed to create event instance");

        const client = createTestClient();
        const result = await client.eventInstance.all({
          aoOrgId: ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        const found = result.eventInstances.find((e) => e.id === instance.id);
        expect(found?.location).toBe("The Ballfield");
      });

      it("should fall back to the formatted address when the name is blank", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create AO");

        // `name` is NOT NULL, so "no name" is the empty string, not null.
        const location = await createTestLocation(region.id, {
          name: "",
          addressStreet: "123 Main St",
          addressCity: "Charlotte",
          addressState: "NC",
        });
        if (!location) throw new Error("Failed to create location");

        const instance = await createTestEventInstance(ao.id, {
          locationId: location.id,
        });
        if (!instance) throw new Error("Failed to create event instance");

        const client = createTestClient();
        const result = await client.eventInstance.all({
          aoOrgId: ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        const found = result.eventInstances.find((e) => e.id === instance.id);
        expect(found?.location).toBe("123 Main St, Charlotte, NC");
      });

      it("should return a null location for an instance without one", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create AO");

        const instance = await createTestEventInstance(ao.id);
        if (!instance) throw new Error("Failed to create event instance");

        const client = createTestClient();
        const result = await client.eventInstance.all({
          aoOrgId: ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        // The left join must not drop locationless rows.
        const found = result.eventInstances.find((e) => e.id === instance.id);
        expect(found).toBeDefined();
        expect(found?.location).toBeNull();
      });

      it("should return only inactive instances when asked", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const seeded = await seedActiveAndInactive();
        if (!seeded) return;

        const client = createTestClient();
        const result = await client.eventInstance.all({
          statuses: ["inactive"],
          aoOrgId: seeded.ao.id,
          pageIndex: 0,
          pageSize: 10,
        });

        const ids = result.eventInstances.map((e) => e.id);
        expect(ids).toContain(seeded.inactive.id);
        expect(ids).not.toContain(seeded.active.id);
      });
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

    it("should bound the start date on both ends, inclusively", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const dayAfter = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split("T")[0]!;
      };

      const before = dayAfter(10);
      const windowStart = dayAfter(20);
      const windowEnd = dayAfter(30);
      const after = dayAfter(40);

      const [tooEarly, onLowerBound, onUpperBound, tooLate] = await Promise.all(
        [before, windowStart, windowEnd, after].map((startDate) =>
          createTestEventInstance(ao.id, { startDate }),
        ),
      );
      if (!tooEarly || !onLowerBound || !onUpperBound || !tooLate) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        startDate: windowStart,
        startDateTo: windowEnd,
        pageIndex: 0,
        pageSize: 50,
      });

      const ids = result.eventInstances.map((e) => e.id);
      // Both bounds are inclusive, so the instances sitting exactly on them stay.
      expect(ids).toContain(onLowerBound.id);
      expect(ids).toContain(onUpperBound.id);
      expect(ids).not.toContain(tooEarly.id);
      expect(ids).not.toContain(tooLate.id);
    });

    it("should accept an upper bound on its own", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const soon = new Date();
      soon.setDate(soon.getDate() + 5);
      const soonStr = soon.toISOString().split("T")[0]!;

      const later = new Date();
      later.setDate(later.getDate() + 60);
      const laterStr = later.toISOString().split("T")[0]!;

      const included = await createTestEventInstance(ao.id, {
        startDate: soonStr,
      });
      const excluded = await createTestEventInstance(ao.id, {
        startDate: laterStr,
      });
      if (!included || !excluded) return;

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        startDateTo: soonStr,
        pageIndex: 0,
        pageSize: 50,
      });

      const ids = result.eventInstances.map((e) => e.id);
      expect(ids).toContain(included.id);
      expect(ids).not.toContain(excluded.id);
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

    it("should not include slackChannels when includeSlackChannelId is omitted", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, {
        slack_channel_id: "C_AO_DEFAULT",
      });
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        meta: { slack_channel_id: "C_INSTANCE" },
      });
      if (!eventInstance) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: "C_REGION_BACK",
      });

      const client = createTestClient();
      const result = await client.eventInstance.byId({ id: eventInstance.id });

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("slackChannels");
    });

    it("should not include slackChannels when includeSlackChannelId is false", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, {
        slack_channel_id: "C_AO_DEFAULT",
      });
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const explicitFalse = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: false,
      });
      const stringFalse = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: "false",
      });

      expect(explicitFalse).not.toHaveProperty("slackChannels");
      expect(stringFalse).not.toHaveProperty("slackChannels");
    });

    it("should trim returned channel IDs", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: " C_AO " });
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        meta: { slack_channel_id: " C_INSTANCE " },
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_INSTANCE", source: "event_instance_meta" },
        backblast: { channelId: "C_INSTANCE", source: "event_instance_meta" },
      });
    });

    it("should use event instance meta slack channel for preblast and backblast", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, {
        slack_channel_id: "C_AO_DEFAULT",
      });
      if (!ao) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: "C_REGION_BACK",
      });

      const eventInstance = await createTestEventInstance(ao.id, {
        meta: { slack_channel_id: "C_INSTANCE" },
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_INSTANCE", source: "event_instance_meta" },
        backblast: { channelId: "C_INSTANCE", source: "event_instance_meta" },
      });
    });

    it("should use region specified channels before AO meta", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: "C_AO" });
      if (!ao) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: "C_REGION_BACK",
        bot_token: "bot-token-secret-should-not-leak",
      });

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_REGION_PRE", source: "region_settings" },
        backblast: { channelId: "C_REGION_BACK", source: "region_settings" },
      });
      expect(JSON.stringify(result)).not.toContain(
        "bot-token-secret-should-not-leak",
      );
      expect(result).not.toHaveProperty("settings");
    });

    it("should return CONFLICT for duplicate region Slack mappings", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE_1",
      });
      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE_2",
      });

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      await expect(
        client.eventInstance.byId({
          id: eventInstance.id,
          includeSlackChannelId: true,
        }),
      ).rejects.toThrow(/Multiple Slack spaces/);
    });

    it("should not use region settings fallback for inactive region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion({ isActive: false });
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: "C_AO" });
      if (!ao) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: "C_REGION_BACK",
      });

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_AO", source: "ao_org_meta" },
        backblast: { channelId: "C_AO", source: "ao_org_meta" },
      });
    });

    it("should not use region settings fallback when AO parent is not a region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nonRegionParent = await createTestNonRegionOrg();
      if (!nonRegionParent) return;

      const ao = await createTestAO(nonRegionParent.id, {
        slack_channel_id: "C_AO",
      });
      if (!ao) return;

      await linkSlackSettingsToRegion(nonRegionParent.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_PARENT_PRE",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: "C_PARENT_BACK",
      });

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_AO", source: "ao_org_meta" },
        backblast: { channelId: "C_AO", source: "ao_org_meta" },
      });
    });

    it("should report specified destinations with null or blank channels as misconfigured", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: "C_AO" });
      if (!ao) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "   ",
        default_backblast_destination: "specified_channel",
        backblast_destination_channel: null,
      });

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: {
          channelId: null,
          source: "region_settings_misconfigured",
        },
        backblast: {
          channelId: null,
          source: "region_settings_misconfigured",
        },
      });
      expect(logWarn).toHaveBeenCalledWith(
        "api.event_instance.slack_channel_misconfigured",
        { kind: "preblast" },
      );
      expect(logWarn).toHaveBeenCalledWith(
        "api.event_instance.slack_channel_misconfigured",
        { kind: "backblast" },
      );
    });

    it("should use AO org meta fallback", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: "C_AO" });
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_AO", source: "ao_org_meta" },
        backblast: { channelId: "C_AO", source: "ao_org_meta" },
      });
    });

    it("should return none when no slack channel can be resolved", async () => {
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
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: null, source: "none" },
        backblast: { channelId: null, source: "none" },
      });
    });

    it("should use region settings for region-owned event without AO fallback", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      await linkSlackSettingsToRegion(region.id, {
        default_preblast_destination: "specified_channel",
        preblast_destination_channel: "C_REGION_PRE",
        default_backblast_destination: "ao_channel",
      });

      const eventInstance = await createTestEventInstance(region.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(result?.org).toBeNull();
      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_REGION_PRE", source: "region_settings" },
        backblast: { channelId: null, source: "none" },
      });
    });

    it("should ignore invalid or non-string event instance meta slack channel", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id, { slack_channel_id: "C_AO" });
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        meta: { slack_channel_id: 123 },
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.byId({
        id: eventInstance.id,
        includeSlackChannelId: true,
      });

      expect(getSlackChannels(result)).toEqual({
        preblast: { channelId: "C_AO", source: "ao_org_meta" },
        backblast: { channelId: "C_AO", source: "ao_org_meta" },
      });
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

    it("should create a standalone event instance with highlight true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const client = createTestClient();
      const eventName = `Convergence ${uniqueId()}`;
      const startDate = new Date().toISOString().split("T")[0]!;

      const result = await client.eventInstance.crupdate({
        name: eventName,
        orgId: ao.id,
        startDate,
        highlight: true,
        isActive: true,
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe(eventName);
      expect(result.highlight).toBe(true);

      const fetched = await client.eventInstance.byId({ id: result.id });
      expect(fetched).not.toBeNull();
      expect(fetched?.highlight).toBe(true);
      expect(fetched?.seriesId).toBeNull();

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

    it("should preserve isActive=false when updating an inactive instance without sending isActive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      // Create an instance then deactivate it directly in the DB
      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      await db
        .update(schema.eventInstances)
        .set({ isActive: false })
        .where(eq(schema.eventInstances.id, instance.id));

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: `Still Inactive ${uniqueId()}`,
        startDate: instance.startDate,
      });

      expect(result.id).toBe(instance.id);
      expect(result.isActive).toBe(false);
    });

    it("should allow explicitly reactivating an inactive instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      await db
        .update(schema.eventInstances)
        .set({ isActive: false })
        .where(eq(schema.eventInstances.id, instance.id));

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: instance.name,
        startDate: instance.startDate,
        isActive: true,
      });

      expect(result.id).toBe(instance.id);
      expect(result.isActive).toBe(true);
    });

    it("should preserve highlight when updating without sending highlight", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id, {
        highlight: true,
      });
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: `Renamed ${uniqueId()}`,
        startDate: instance.startDate,
      });

      expect(result.id).toBe(instance.id);
      expect(result.highlight).toBe(true);
    });

    it("should allow explicitly clearing highlight", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id, {
        highlight: true,
      });
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: instance.name,
        startDate: instance.startDate,
        highlight: false,
      });

      expect(result.id).toBe(instance.id);
      expect(result.highlight).toBe(false);
    });

    it("should preserve isPrivate when updating without sending isPrivate", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id, {
        isPrivate: true,
      });
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: `Renamed ${uniqueId()}`,
        startDate: instance.startDate,
      });

      expect(result.id).toBe(instance.id);
      expect(result.isPrivate).toBe(true);
    });

    it("should allow explicitly making a private instance public", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id, {
        isPrivate: true,
      });
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: instance.name,
        startDate: instance.startDate,
        isPrivate: false,
      });

      expect(result.id).toBe(instance.id);
      expect(result.isPrivate).toBe(false);
    });

    it("should default highlight and isPrivate to false on create", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        orgId: ao.id,
        name: `Created ${uniqueId()}`,
        startDate: new Date().toISOString().split("T")[0]!,
      });

      if (result.id) {
        createdEventInstanceIds.push(result.id);
      }

      expect(result.highlight).toBe(false);
      expect(result.isPrivate).toBe(false);
    });

    it("should clear startTime when null is sent", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        startTime: "0530",
        endTime: "0615",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        startTime: null,
      });

      expect(result.startTime).toBeNull();
      // Only the cleared field is affected.
      expect(result.endTime).toBe("0615");
    });

    it("should clear endTime when null is sent", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        startTime: "0530",
        endTime: "0615",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        endTime: null,
      });

      expect(result.endTime).toBeNull();
      expect(result.startTime).toBe("0530");
    });

    it("should clear both times when both are sent as null", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        startTime: "0530",
        endTime: "0615",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        startTime: null,
        endTime: null,
      });

      expect(result.startTime).toBeNull();
      expect(result.endTime).toBeNull();
    });

    it("should preserve times when they are omitted", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id, {
        startTime: "0530",
        endTime: "0615",
      });
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        id: eventInstance.id,
        name: `Updated Event ${uniqueId()}`,
        orgId: ao.id,
        startDate: eventInstance.startDate,
      });

      expect(result.startTime).toBe("0530");
      expect(result.endTime).toBe("0615");
    });

    // The join-table branches of crupdate: presence of the key decides whether
    // the association is rewritten, mirroring the startTime/endTime cases above.
    it("should clear the event type association when eventTypeIds is empty, and preserve it when omitted", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const eventType = await createTestEventType();
      if (!eventType) throw new Error("Failed to create event type");

      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();

      const readAssociations = async () =>
        db
          .select({
            eventTypeId: schema.eventInstancesXEventTypes.eventTypeId,
          })
          .from(schema.eventInstancesXEventTypes)
          .where(
            eq(schema.eventInstancesXEventTypes.eventInstanceId, instance.id),
          );

      // Set the association.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [eventType.id],
      });
      expect(await readAssociations()).toEqual([{ eventTypeId: eventType.id }]);

      // Key omitted entirely — the association must survive untouched.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
      });
      expect(await readAssociations()).toEqual([{ eventTypeId: eventType.id }]);

      // An explicit empty array clears it.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [],
      });
      expect(await readAssociations()).toEqual([]);
    });

    it("should link every event type in eventTypeIds, replacing what was there", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const first = await createTestEventType();
      const second = await createTestEventType();
      const third = await createTestEventType();
      if (!first || !second || !third)
        throw new Error("Failed to create event types");

      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();

      const readAssociations = async () => {
        const rows = await db
          .select({
            eventTypeId: schema.eventInstancesXEventTypes.eventTypeId,
          })
          .from(schema.eventInstancesXEventTypes)
          .where(
            eq(schema.eventInstancesXEventTypes.eventInstanceId, instance.id),
          );
        // The join table has no inherent order, so compare as a set.
        return rows.map((r) => r.eventTypeId).sort((a, b) => a - b);
      };

      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [first.id, second.id],
      });
      expect(await readAssociations()).toEqual(
        [first.id, second.id].sort((a, b) => a - b),
      );

      // A new list replaces the old one wholesale rather than adding to it.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [third.id],
      });
      expect(await readAssociations()).toEqual([third.id]);

      // Repeats in the payload would break the join table's primary key.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [first.id, first.id],
      });
      expect(await readAssociations()).toEqual([first.id]);

      // An empty array is a deliberate clear, not an untouched field.
      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [],
      });
      expect(await readAssociations()).toEqual([]);
    });

    // Regression: the association is rewritten as DELETE-then-INSERT. A bogus
    // eventTypeId violates event_instances_x_event_types_event_type_id_fkey on
    // the INSERT — i.e. after the DELETE has already run. Without a surrounding
    // transaction the delete commits on its own and the caller silently loses
    // the association they never asked to remove.
    it("should roll back the event type association when the rewrite fails mid-flow", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const eventType = await createTestEventType();
      if (!eventType) throw new Error("Failed to create event type");

      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      const client = createTestClient();

      await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        startDate: instance.startDate,
        eventTypeIds: [eventType.id],
      });

      await expect(
        client.eventInstance.crupdate({
          id: instance.id,
          orgId: ao.id,
          startDate: instance.startDate,
          eventTypeIds: [999999999],
        }),
      ).rejects.toThrow();

      const associations = await db
        .select({
          eventTypeId: schema.eventInstancesXEventTypes.eventTypeId,
        })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(schema.eventInstancesXEventTypes.eventInstanceId, instance.id),
        );

      // Still the original association, not an empty set.
      expect(associations).toEqual([{ eventTypeId: eventType.id }]);
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
        eventTypeIds: [eventType.id],
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

    it("should clear event type when eventTypeIds is empty", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      const eventType = await createTestEventType();
      if (!eventInstance || !eventType) return;

      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: eventInstance.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        eventTypeIds: [],
      });

      const linkRecords = await db
        .select()
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            eventInstance.id,
          ),
        );

      expect(linkRecords).toHaveLength(0);
    });

    it("should preserve event type when eventTypeIds is omitted", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      const eventType = await createTestEventType();
      if (!eventInstance || !eventType) return;

      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: eventInstance.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      await client.eventInstance.crupdate({
        id: eventInstance.id,
        name: `Updated Event ${uniqueId()}`,
        orgId: ao.id,
        startDate: eventInstance.startDate,
      });

      const linkRecords = await db
        .select()
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            eventInstance.id,
          ),
        );

      expect(linkRecords).toHaveLength(1);
      expect(linkRecords[0]?.eventTypeId).toBe(eventType.id);
    });

    it("should replace event type when a different eventTypeIds is sent", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      const original = await createTestEventType();
      const replacement = await createTestEventType();
      if (!eventInstance || !original || !replacement) return;

      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: eventInstance.id,
        eventTypeId: original.id,
      });

      const client = createTestClient();
      await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        eventTypeIds: [replacement.id],
      });

      const linkRecords = await db
        .select()
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            eventInstance.id,
          ),
        );

      expect(linkRecords).toHaveLength(1);
      expect(linkRecords[0]?.eventTypeId).toBe(replacement.id);
    });

    it("should create event instance with event tag", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventTag = await createTestEventTag();
      if (!eventTag) return;

      const client = createTestClient();
      const result = await client.eventInstance.crupdate({
        name: `Event With Tag ${uniqueId()}`,
        orgId: ao.id,
        startDate: new Date().toISOString().split("T")[0]!,
        eventTagId: eventTag.id,
      });

      expect(result).toBeDefined();

      if (result.id) {
        createdEventInstanceIds.push(result.id);

        const [linkRecord] = await db
          .select()
          .from(schema.eventTagsXEventInstances)
          .where(
            eq(schema.eventTagsXEventInstances.eventInstanceId, result.id),
          );

        expect(linkRecord).toBeDefined();
        expect(linkRecord?.eventTagId).toBe(eventTag.id);
      }
    });

    it("should clear event tag when eventTagId is null", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      const eventTag = await createTestEventTag();
      if (!eventInstance || !eventTag) return;

      await db.insert(schema.eventTagsXEventInstances).values({
        eventInstanceId: eventInstance.id,
        eventTagId: eventTag.id,
      });

      const client = createTestClient();
      await client.eventInstance.crupdate({
        id: eventInstance.id,
        orgId: ao.id,
        startDate: eventInstance.startDate,
        eventTagId: null,
      });

      const linkRecords = await db
        .select()
        .from(schema.eventTagsXEventInstances)
        .where(
          eq(schema.eventTagsXEventInstances.eventInstanceId, eventInstance.id),
        );

      expect(linkRecords).toHaveLength(0);
    });

    it("should preserve event tag when eventTagId is omitted", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      const eventTag = await createTestEventTag();
      if (!eventInstance || !eventTag) return;

      await db.insert(schema.eventTagsXEventInstances).values({
        eventInstanceId: eventInstance.id,
        eventTagId: eventTag.id,
      });

      const client = createTestClient();
      await client.eventInstance.crupdate({
        id: eventInstance.id,
        name: `Updated Event ${uniqueId()}`,
        orgId: ao.id,
        startDate: eventInstance.startDate,
      });

      const linkRecords = await db
        .select()
        .from(schema.eventTagsXEventInstances)
        .where(
          eq(schema.eventTagsXEventInstances.eventInstanceId, eventInstance.id),
        );

      expect(linkRecords).toHaveLength(1);
      expect(linkRecords[0]?.eventTagId).toBe(eventTag.id);
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

    it("should reject cross-org update even when editor of submitted orgId", async () => {
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const aoA = await createTestAO(region.id);
      if (!aoA) throw new Error("Failed to create AO A");
      const aoB = await createTestAO(region.id);
      if (!aoB) throw new Error("Failed to create AO B");

      const instance = await createTestEventInstance(aoA.id);
      if (!instance) throw new Error("Failed to create event instance");

      // Editor only has permission on aoB, not aoA
      const editorBSession = {
        id: 500,
        email: "editor-b@example.com",
        user: {
          id: "500",
          email: "editor-b@example.com",
          name: "Editor B",
          roles: [
            { orgId: aoB.id, orgName: aoB.name, roleName: "editor" as const },
          ],
        },
        roles: [
          { orgId: aoB.id, orgName: aoB.name, roleName: "editor" as const },
        ],
        expires: new Date(Date.now() + 86_400_000).toISOString(),
      };
      await mockAuthWithSession(editorBSession);

      const client = createTestClient();
      await expect(
        client.eventInstance.crupdate({
          id: instance.id,
          orgId: aoB.id,
          name: `Hijacked ${uniqueId()}`,
          startDate: instance.startDate,
        }),
      ).rejects.toThrow(/not authorized to update/i);
    });

    it("should reject move when editor lacks role on destination org", async () => {
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const aoA = await createTestAO(region.id);
      if (!aoA) throw new Error("Failed to create AO A");
      const aoB = await createTestAO(region.id);
      if (!aoB) throw new Error("Failed to create AO B");

      const instance = await createTestEventInstance(aoA.id);
      if (!instance) throw new Error("Failed to create event instance");

      // Editor has role on aoA only — authorized to update but not to move to aoB
      const editorASession = {
        id: 501,
        email: "editor-a@example.com",
        user: {
          id: "501",
          email: "editor-a@example.com",
          name: "Editor A",
          roles: [
            { orgId: aoA.id, orgName: aoA.name, roleName: "editor" as const },
          ],
        },
        roles: [
          { orgId: aoA.id, orgName: aoA.name, roleName: "editor" as const },
        ],
        expires: new Date(Date.now() + 86_400_000).toISOString(),
      };
      await mockAuthWithSession(editorASession);

      const client = createTestClient();
      await expect(
        client.eventInstance.crupdate({
          id: instance.id,
          orgId: aoB.id,
          name: instance.name,
          startDate: instance.startDate,
        }),
      ).rejects.toThrow(/not authorized to move/i);
    });

    it("should allow in-place update by editor of the owning org", async () => {
      const adminSession = await createAdminSession();
      await mockAuthWithSession(adminSession);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const instance = await createTestEventInstance(ao.id);
      if (!instance) throw new Error("Failed to create event instance");

      const editorSession = {
        id: 502,
        email: "editor-own@example.com",
        user: {
          id: "502",
          email: "editor-own@example.com",
          name: "Editor Owner",
          roles: [
            { orgId: ao.id, orgName: ao.name, roleName: "editor" as const },
          ],
        },
        roles: [
          { orgId: ao.id, orgName: ao.name, roleName: "editor" as const },
        ],
        expires: new Date(Date.now() + 86_400_000).toISOString(),
      };
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const updatedName = `Updated In Place ${uniqueId()}`;
      const result = await client.eventInstance.crupdate({
        id: instance.id,
        orgId: ao.id,
        name: updatedName,
        startDate: instance.startDate,
      });

      expect(result.id).toBe(instance.id);
      expect(result.name).toBe(updatedName);
    });

    it("should throw NOT_FOUND when updating a nonexistent id", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      await expect(
        client.eventInstance.crupdate({
          id: 999_999_999,
          orgId: 1,
          name: `Ghost ${uniqueId()}`,
          startDate: new Date().toISOString().split("T")[0]!,
        }),
      ).rejects.toThrow(/not found/i);
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

      expect(result).toEqual({ eventInstanceId: eventInstance.id });

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

    // The cases below deliberately order the sort column *opposite* to
    // startDate. An id the router doesn't map falls through to sorting by
    // startDate, which would return the reverse of what each test expects.
    it("should sort by end date, not fall back to start date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const dayAfter = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split("T")[0]!;
      };

      const first = await createTestEventInstance(ao.id, {
        startDate: dayAfter(10),
        endDate: dayAfter(40),
      });
      const second = await createTestEventInstance(ao.id, {
        startDate: dayAfter(20),
        endDate: dayAfter(30),
      });
      const third = await createTestEventInstance(ao.id, {
        startDate: dayAfter(30),
        endDate: dayAfter(20),
      });
      if (!first || !second || !third) {
        throw new Error("Failed to create event instances");
      }

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        sorting: [{ id: "endDate", desc: false }],
        pageIndex: 0,
        pageSize: 50,
      });

      expect(result.eventInstances.map((e) => e.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
    });

    it("should sort by AO name, not fall back to start date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const suffix = uniqueId();
      const firstAlphabetically = await createTestAO(
        region.id,
        undefined,
        `AAA AO ${suffix}`,
      );
      const lastAlphabetically = await createTestAO(
        region.id,
        undefined,
        `ZZZ AO ${suffix}`,
      );
      if (!firstAlphabetically || !lastAlphabetically) {
        throw new Error("Failed to create AOs");
      }

      const dayAfter = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split("T")[0]!;
      };

      // The alphabetically-first AO gets the *later* start date.
      const inAaa = await createTestEventInstance(firstAlphabetically.id, {
        startDate: dayAfter(30),
      });
      const inZzz = await createTestEventInstance(lastAlphabetically.id, {
        startDate: dayAfter(10),
      });
      if (!inAaa || !inZzz) {
        throw new Error("Failed to create event instances");
      }

      const client = createTestClient();
      const result = await client.eventInstance.all({
        regionOrgId: region.id,
        sorting: [{ id: "aoName", desc: false }],
        pageIndex: 0,
        pageSize: 50,
      });

      expect(result.eventInstances.map((e) => e.id)).toEqual([
        inAaa.id,
        inZzz.id,
      ]);
    });

    it("should sort by location name, not fall back to start date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const suffix = uniqueId();
      const firstAlphabetically = await createTestLocation(region.id, {
        name: `AAA Location ${suffix}`,
      });
      const lastAlphabetically = await createTestLocation(region.id, {
        name: `ZZZ Location ${suffix}`,
      });
      if (!firstAlphabetically || !lastAlphabetically) {
        throw new Error("Failed to create locations");
      }

      const dayAfter = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split("T")[0]!;
      };

      // The alphabetically-first location gets the later start date.
      const atAaa = await createTestEventInstance(ao.id, {
        locationId: firstAlphabetically.id,
        startDate: dayAfter(30),
      });
      const atZzz = await createTestEventInstance(ao.id, {
        locationId: lastAlphabetically.id,
        startDate: dayAfter(10),
      });
      if (!atAaa || !atZzz) {
        throw new Error("Failed to create event instances");
      }

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        sorting: [{ id: "location", desc: false }],
        pageIndex: 0,
        pageSize: 50,
      });

      expect(result.eventInstances.map((e) => e.id)).toEqual([
        atAaa.id,
        atZzz.id,
      ]);
    });

    it("should sort by status, not fall back to start date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create AO");

      const dayAfter = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split("T")[0]!;
      };

      // The inactive instance gets the later start date, so a fall-through to
      // startDate would put the active one first.
      const active = await createTestEventInstance(ao.id, {
        startDate: dayAfter(10),
        isActive: true,
      });
      const inactive = await createTestEventInstance(ao.id, {
        startDate: dayAfter(30),
        isActive: false,
      });
      if (!active || !inactive) {
        throw new Error("Failed to create event instances");
      }

      const client = createTestClient();
      const result = await client.eventInstance.all({
        aoOrgId: ao.id,
        statuses: ["active", "inactive"],
        sorting: [{ id: "isActive", desc: false }],
        pageIndex: 0,
        pageSize: 50,
      });

      expect(result.eventInstances.map((e) => e.id)).toEqual([
        inactive.id,
        active.id,
      ]);
    });
  });
});
