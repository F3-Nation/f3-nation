/**
 * Tests for Org Chart Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

import { schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../../__tests__/test-utils";

type OrgType = "nation" | "sector" | "area" | "region" | "ao";

describe("Org Chart Router", () => {
  const createdEventIds: number[] = [];
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
  });

  afterAll(async () => {
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

  const createOrg = async (params: {
    orgType: OrgType;
    parentId?: number | null;
  }) => {
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Test ${params.orgType} ${uniqueId()}`,
        orgType: params.orgType,
        parentId: params.parentId ?? null,
        isActive: true,
      })
      .returning();

    if (org) {
      createdOrgIds.push(org.id);
    }

    return org;
  };

  const createLocation = async (orgId: number) => {
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

  const createEvent = async (params: { orgId: number; locationId: number }) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `Test Event ${uniqueId()}`,
        orgId: params.orgId,
        locationId: params.locationId,
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

    return event;
  };

  describe("all", () => {
    it("should only return orgs with direct active locations", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const sector = await createOrg({
        orgType: "sector",
        parentId: nation.id,
      });
      const area = sector
        ? await createOrg({ orgType: "area", parentId: sector.id })
        : null;
      const region = area
        ? await createOrg({ orgType: "region", parentId: area.id })
        : null;
      const ao = region
        ? await createOrg({ orgType: "ao", parentId: region.id })
        : null;

      if (!region || !ao) {
        return;
      }

      const location = await createLocation(region.id);
      if (!location) {
        return;
      }

      await createEvent({ orgId: ao.id, locationId: location.id });

      const regionWithoutLocation = area
        ? await createOrg({ orgType: "region", parentId: area.id })
        : null;

      const client = createTestClient();
      const result = await client.orgChart.all();

      const returnedOrgIds = result.orgs.map((org) => org.orgId);
      const regionSummary = result.orgs.find((org) => org.orgId === region.id);

      expect(returnedOrgIds).toContain(region.id);
      if (sector) {
        expect(returnedOrgIds).not.toContain(sector.id);
      }
      if (area) {
        expect(returnedOrgIds).not.toContain(area.id);
      }
      expect(returnedOrgIds).not.toContain(nation.id);
      expect(returnedOrgIds).not.toContain(ao.id);
      if (regionWithoutLocation) {
        expect(returnedOrgIds).not.toContain(regionWithoutLocation.id);
      }

      expect(regionSummary).toBeDefined();
      if (regionSummary) {
        expect(regionSummary.activeLocations.length).toBe(1);
        expect(regionSummary.activeLocations[0]?.eventCount).toBe(1);
        expect(regionSummary.activeLocations[0]?.aoCount).toBe(1);
      }

      expect(result.orgs.every((org) => org.activeLocations.length > 0)).toBe(
        true,
      );
      expect(result.orgs.every((org) => org.orgType === "region")).toBe(true);
    });

    it("should count distinct AOs per location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const sector = await createOrg({
        orgType: "sector",
        parentId: nation.id,
      });
      const area = sector
        ? await createOrg({ orgType: "area", parentId: sector.id })
        : null;
      const region = area
        ? await createOrg({ orgType: "region", parentId: area.id })
        : null;

      if (!region) {
        return;
      }

      const aoOne = await createOrg({ orgType: "ao", parentId: region.id });
      const aoTwo = await createOrg({ orgType: "ao", parentId: region.id });

      if (!aoOne || !aoTwo) {
        return;
      }

      const location = await createLocation(region.id);
      if (!location) {
        return;
      }

      await createEvent({ orgId: aoOne.id, locationId: location.id });
      await createEvent({ orgId: aoTwo.id, locationId: location.id });

      const client = createTestClient();
      const result = await client.orgChart.all();
      const regionSummary = result.orgs.find((org) => org.orgId === region.id);

      expect(regionSummary).toBeDefined();
      if (regionSummary) {
        const locationSummary = regionSummary.activeLocations.find(
          (activeLocation) =>
            activeLocation.latitude === 35.5 &&
            activeLocation.longitude === -80.5,
        );

        expect(locationSummary).toBeDefined();
        if (locationSummary) {
          expect(locationSummary.aoCount).toBe(2);
        }
      }
    });
  });

  describe("byId", () => {
    it("should return organization details for a valid id", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const sector = await createOrg({
        orgType: "sector",
        parentId: nation.id,
      });

      if (!sector) {
        return;
      }

      const client = createTestClient();
      const result = await client.orgChart.byId({ orgId: sector.id });

      expect(result).toBeDefined();
      expect(result.id).toBe(sector.id);
      expect(result.name).toBe(sector.name);
      expect(result.orgType).toBe("sector");
      expect(result.positions).toBeDefined();
      expect(Array.isArray(result.positions)).toBe(true);
    });

    it("should throw an error when organization is not found", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.orgChart.byId({ orgId: 999999999 }),
      ).rejects.toThrow();
    });
  });
});
