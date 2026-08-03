/**
 * Tests for Event Instance Router endpoints
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

vi.mock("../logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../logger")>()),
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
  ) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Test AO ${uniqueId()}`,
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

  // Helper to create a test event instance
  const createTestEventInstance = async (
    orgId: number,
    options?: {
      name?: string;
      startDate?: string;
      highlight?: boolean;
      seriesException?: SeriesException;
      startTime?: string | null;
      endTime?: string | null;
      meta?: Record<string, unknown>;
    },
  ) => {
    const [eventInstance] = await db
      .insert(schema.eventInstances)
      .values({
        name: options?.name ?? `Test Event ${uniqueId()}`,
        orgId,
        startDate:
          options?.startDate ?? new Date().toISOString().split("T")[0]!,
        isActive: true,
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
        eventTypeId: eventType.id,
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

    it("should clear event type when eventTypeId is null", async () => {
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
        eventTypeId: null,
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

    it("should preserve event type when eventTypeId is omitted", async () => {
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

    it("should replace event type when a different eventTypeId is sent", async () => {
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
        eventTypeId: replacement.id,
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
  });
});
