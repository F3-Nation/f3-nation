/**
 * Tests for Event Tag Router endpoints
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

import { eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("Event Tag Router", () => {
  // Track created resources for cleanup
  const createdEventTagIds: number[] = [];
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
  });

  afterAll(async () => {
    // Clean up in reverse order
    for (const eventTagId of createdEventTagIds.reverse()) {
      try {
        // First delete any event tag links
        await db
          .delete(schema.eventTagsXEventInstances)
          .where(eq(schema.eventTagsXEventInstances.eventTagId, eventTagId));
        await db
          .delete(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventTagId, eventTagId));
        // Then delete the event tag
        await db
          .delete(schema.eventTags)
          .where(eq(schema.eventTags.id, eventTagId));
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

  // Helper to create a test region
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

  // Helper to create a test event tag
  const createTestEventTag = async (options?: {
    name?: string;
    specificOrgId?: number | null;
    isActive?: boolean;
  }) => {
    const [eventTag] = await db
      .insert(schema.eventTags)
      .values({
        name: options?.name ?? `Test Event Tag ${uniqueId()}`,
        specificOrgId: options?.specificOrgId ?? null,
        isActive: options?.isActive ?? true,
        color: "#FF0000",
      })
      .returning();

    if (eventTag) {
      createdEventTagIds.push(eventTag.id);
    }
    return eventTag;
  };

  describe("all", () => {
    it("should return a list of event tags", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.eventTag.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("eventTags");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.eventTags)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const page1 = await client.eventTag.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.eventTag.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.eventTags.length).toBeLessThanOrEqual(2);
      expect(page2.eventTags.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 event tags
      if (
        page1.totalCount > 2 &&
        page1.eventTags.length > 0 &&
        page2.eventTags.length > 0
      ) {
        expect(page1.eventTags[0]?.id).not.toBe(page2.eventTags[0]?.id);
      }
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const uniqueName = `SearchableEventTag ${uniqueId()}`;
      const eventTag = await createTestEventTag({ name: uniqueName });

      const client = createTestClient();
      const result = await client.eventTag.all({
        searchTerm: "SearchableEventTag",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created event tag
      const found = result.eventTags.some((et) => et.id === eventTag?.id);
      expect(found).toBe(true);
    });

    it("should filter by org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create an event tag for this region
      const eventTag = await createTestEventTag({
        specificOrgId: region.id,
      });

      const client = createTestClient();
      const result = await client.eventTag.all({
        orgIds: [region.id],
        pageIndex: 0,
        pageSize: 10,
      });

      // Should include our created event tag
      const found = result.eventTags.some((et) => et.id === eventTag?.id);
      expect(found).toBe(true);
    });

    it("should include nation-wide event tags by default", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a nation-wide event tag (no specificOrgId)
      const nationEventTag = await createTestEventTag({
        name: `Nation Event Tag ${uniqueId()}`,
        specificOrgId: null,
      });

      const client = createTestClient();
      const result = await client.eventTag.all({
        orgIds: [region.id],
        pageIndex: 0,
        pageSize: 100,
      });

      // Should include nation-wide event tag
      const found = result.eventTags.some((et) => et.id === nationEventTag?.id);
      expect(found).toBe(true);
    });

    it("should exclude nation-wide event tags when ignoreNationEventTags is true", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create a region-specific event tag
      const regionEventTag = await createTestEventTag({
        name: `Region Event Tag ${uniqueId()}`,
        specificOrgId: region.id,
      });

      // Create a nation-wide event tag
      const nationEventTag = await createTestEventTag({
        name: `Nation Event Tag ${uniqueId()}`,
        specificOrgId: null,
      });

      const client = createTestClient();
      const result = await client.eventTag.all({
        orgIds: [region.id],
        ignoreNationEventTags: true,
        pageIndex: 0,
        pageSize: 100,
      });

      // Should include region-specific event tag
      const foundRegionTag = result.eventTags.some(
        (et) => et.id === regionEventTag?.id,
      );
      expect(foundRegionTag).toBe(true);

      // Should NOT include nation-wide event tag
      const foundNationTag = result.eventTags.some(
        (et) => et.id === nationEventTag?.id,
      );
      expect(foundNationTag).toBe(false);
    });

    it("should filter by status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const activeResult = await client.eventTag.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeResult.eventTags.every((et) => et.isActive === true)).toBe(
        true,
      );
    });
  });

  describe("byId", () => {
    it("should return event tag by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const eventTag = await createTestEventTag();
      if (!eventTag) return;

      const client = createTestClient();
      const result = await client.eventTag.byId({
        id: eventTag.id,
      });

      expect(result).toHaveProperty("eventTag");
      expect(result.eventTag).not.toBeNull();
      expect(result.eventTag?.id).toBe(eventTag.id);
    });

    it("should throw NOT_FOUND for non-existent event tag", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.eventTag.byId({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("byOrgId", () => {
    it("should return event tags for a specific org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create an event tag for this org
      const eventTag = await createTestEventTag({
        specificOrgId: region.id,
      });

      const client = createTestClient();
      const result = await client.eventTag.byOrgId({
        orgId: region.id,
      });

      expect(result).toHaveProperty("eventTags");
      expect(Array.isArray(result.eventTags)).toBe(true);

      // Should include our created event tag
      const found = result.eventTags.some((et) => et.id === eventTag?.id);
      expect(found).toBe(true);
    });

    it("should return empty for org with no event tags", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const client = createTestClient();
      const result = await client.eventTag.byOrgId({
        orgId: region.id,
      });

      // Should return empty array (no event tags for this specific org)
      expect(result.eventTags).toEqual([]);
    });

    it("should filter by active status", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      // Create active and inactive event tags
      await createTestEventTag({
        specificOrgId: region.id,
        isActive: true,
      });

      await createTestEventTag({
        specificOrgId: region.id,
        isActive: false,
      });

      const client = createTestClient();
      const result = await client.eventTag.byOrgId({
        orgId: region.id,
        isActive: true,
      });

      // All returned should be active
      expect(result.eventTags.every((et) => et.isActive === true)).toBe(true);
    });
  });

  describe("crupdate", () => {
    it("should create a new event tag for nation", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const eventTagName = `Test Event Tag ${uniqueId()}`;

      const result = await client.eventTag.crupdate({
        name: eventTagName,
        color: "#00FF00",
        isActive: true,
      });

      expect(result).toHaveProperty("eventTag");
      expect(Array.isArray(result.eventTag)).toBe(true);
      expect(result.eventTag.length).toBeGreaterThan(0);

      const created = result.eventTag[0];
      if (created) {
        expect(created.name).toBe(eventTagName);
        createdEventTagIds.push(created.id);
      }
    });

    it("should create event tag for a specific org", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const client = createTestClient();
      const eventTagName = `Org Specific Event Tag ${uniqueId()}`;

      const result = await client.eventTag.crupdate({
        name: eventTagName,
        color: "#0000FF",
        specificOrgId: region.id,
        isActive: true,
      });

      expect(result).toHaveProperty("eventTag");
      expect(Array.isArray(result.eventTag)).toBe(true);

      const created = result.eventTag[0];
      if (created) {
        expect(created.name).toBe(eventTagName);
        expect(created.specificOrgId).toBe(region.id);
        createdEventTagIds.push(created.id);
      }
    });

    it("should update an existing event tag", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const eventTag = await createTestEventTag();
      if (!eventTag) return;

      const client = createTestClient();
      const updatedName = `Updated Event Tag ${uniqueId()}`;

      const result = await client.eventTag.crupdate({
        id: eventTag.id,
        name: updatedName,
        color: "#FFFF00",
        isActive: true,
      });

      expect(result).toHaveProperty("eventTag");
      expect(Array.isArray(result.eventTag)).toBe(true);

      const updated = result.eventTag[0];
      expect(updated?.id).toBe(eventTag.id);
      expect(updated?.name).toBe(updatedName);
    });
  });

  describe("delete", () => {
    it("should soft delete event tag for nation admin", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const eventTag = await createTestEventTag();
      if (!eventTag) return;

      const client = createTestClient();
      await client.eventTag.delete({
        id: eventTag.id,
      });

      // Verify soft deletion (isActive should be false)
      const [deleted] = await db
        .select()
        .from(schema.eventTags)
        .where(eq(schema.eventTags.id, eventTag.id));

      expect(deleted).toBeDefined();
      expect(deleted?.isActive).toBe(false);
    });

    it("should silently succeed for non-existent event tag", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // The delete endpoint doesn't throw for non-existent records
      // It just silently updates nothing
      await expect(
        client.eventTag.delete({
          id: 999999,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("sorting", () => {
    it("should sort by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create event tags with different names
      await createTestEventTag({ name: `AAA Tag ${uniqueId()}` });
      await createTestEventTag({ name: `ZZZ Tag ${uniqueId()}` });

      const client = createTestClient();
      const result = await client.eventTag.all({
        sorting: [{ id: "name", desc: false }],
        pageIndex: 0,
        pageSize: 100,
      });

      if (result.eventTags.length >= 2) {
        const names = result.eventTags.map((et) => et.name);
        // Should be sorted ascending
        for (let i = 1; i < names.length; i++) {
          expect(names[i]!.localeCompare(names[i - 1]!) >= 0).toBe(true);
        }
      }
    });
  });
});
