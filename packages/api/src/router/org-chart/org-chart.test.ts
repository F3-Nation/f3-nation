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
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { eq, inArray, schema } from "@acme/db";
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

import type { OrgType } from "@acme/shared/app/enums";

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

      const orgs = result.orgs.filter((org): org is NonNullable<typeof org> =>
        Boolean(org),
      );
      const returnedOrgIds = orgs.map((org) => org.orgId);
      const regionSummary = orgs.find((org) => org.orgId === region.id);

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
      if (!regionSummary) {
        throw new Error("Expected region summary to be defined");
      }
      expect(regionSummary.activeLocations.length).toBe(1);
      expect(regionSummary.activeLocations[0]?.eventCount).toBe(1);
      expect(regionSummary.activeLocations[0]?.aoCount).toBe(1);

      expect(orgs.every((org) => org.activeLocations.length > 0)).toBe(true);
      expect(orgs.every((org) => org.orgType === "region")).toBe(true);
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
      const orgs = result.orgs.filter((org): org is NonNullable<typeof org> =>
        Boolean(org),
      );
      const regionSummary = orgs.find((org) => org.orgId === region.id);

      expect(regionSummary).toBeDefined();
      if (regionSummary) {
        const locationSummary = regionSummary.activeLocations.find(
          (activeLocation) =>
            activeLocation.latitude === 35.5 &&
            activeLocation.longitude === -80.5,
        );

        expect(locationSummary).toBeDefined();
        if (!locationSummary) {
          throw new Error("Expected location summary to be defined");
        }
        expect(locationSummary.aoCount).toBe(2);
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
        throw new Error("Failed to create sector for test");
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

  describe("leadership", () => {
    it("lists position and role holders at active non-AO orgs only", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const region = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
      const ao = region
        ? await createOrg({ orgType: "ao", parentId: region.id })
        : null;
      const inactive = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
      if (!region || !ao || !inactive) {
        throw new Error("Failed to create org fixtures");
      }
      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, inactive.id));

      const [user] = await db
        .insert(schema.users)
        .values({
          email: `test-${uniqueId()}@example.com`,
          f3Name: "Table Leader",
          homeRegionId: region.id,
        })
        .returning();
      const [position] = await db
        .insert(schema.positions)
        .values({ name: `Test Position ${uniqueId()}`, isActive: true })
        .returning();
      const [role] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));
      if (!user || !position || !role) {
        throw new Error("Failed to create user/position/role fixtures");
      }
      await db.insert(schema.positionsXOrgsXUsers).values([
        { positionId: position.id, orgId: region.id, userId: user.id },
        { positionId: position.id, orgId: ao.id, userId: user.id },
        { positionId: position.id, orgId: inactive.id, userId: user.id },
      ]);
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ roleId: role.id, orgId: region.id, userId: user.id });

      try {
        const client = createTestClient();
        const result = await client.orgChart.leadership();
        const mine = result.leaders.filter((l) => l.userId === user.id);

        expect(mine).toEqual(
          expect.arrayContaining([
            {
              orgId: region.id,
              kind: "position",
              id: position.id,
              title: position.name,
              userId: user.id,
              f3Name: "Table Leader",
              avatarUrl: null,
              homeRegionName: region.name,
            },
            {
              orgId: region.id,
              kind: "role",
              id: role.id,
              title: "admin",
              userId: user.id,
              f3Name: "Table Leader",
              avatarUrl: null,
              homeRegionName: region.name,
            },
          ]),
        );
        expect(mine).toHaveLength(2);
      } finally {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(eq(schema.positionsXOrgsXUsers.positionId, position.id));
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, user.id));
        await db
          .delete(schema.positions)
          .where(eq(schema.positions.id, position.id));
        await cleanup.user(user.id);
      }
    });

    it("lists active orgs without locations and drops inactive chains, positions and users", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const region = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
      const ao = region
        ? await createOrg({ orgType: "ao", parentId: region.id })
        : null;
      const inactive = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
      const deadSector = await createOrg({
        orgType: "sector",
        parentId: nation.id,
      });
      const underDead = deadSector
        ? await createOrg({ orgType: "region", parentId: deadSector.id })
        : null;
      if (!region || !ao || !inactive || !deadSector || !underDead) {
        throw new Error("Failed to create org fixtures");
      }
      await db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(inArray(schema.orgs.id, [inactive.id, deadSector.id]));

      const [leader] = await db
        .insert(schema.users)
        .values({
          email: `test-${uniqueId()}@example.com`,
          f3Name: "Away Leader",
          homeRegionId: inactive.id,
        })
        .returning();
      const [gone] = await db
        .insert(schema.users)
        .values({
          email: `test-${uniqueId()}@example.com`,
          f3Name: "Gone Leader",
          status: "inactive",
        })
        .returning();
      const [position] = await db
        .insert(schema.positions)
        .values({ name: `Test Position ${uniqueId()}`, isActive: true })
        .returning();
      const [retired] = await db
        .insert(schema.positions)
        .values({ name: `Retired Position ${uniqueId()}`, isActive: false })
        .returning();
      const [role] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));
      if (!leader || !gone || !position || !retired || !role) {
        throw new Error("Failed to create user/position/role fixtures");
      }
      await db.insert(schema.positionsXOrgsXUsers).values([
        { positionId: position.id, orgId: region.id, userId: leader.id },
        { positionId: retired.id, orgId: region.id, userId: leader.id },
        { positionId: position.id, orgId: underDead.id, userId: leader.id },
        { positionId: position.id, orgId: region.id, userId: gone.id },
      ]);
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ roleId: role.id, orgId: region.id, userId: gone.id });

      try {
        const client = createTestClient();
        const result = await client.orgChart.leadership();

        // The region has no locations but is still listed (unlike the chart).
        expect(result.orgs).toContainEqual({
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId: nation.id,
        });
        const orgIds = new Set(result.orgs.map((o) => o.id));
        expect(orgIds.has(ao.id)).toBe(false);
        expect(orgIds.has(inactive.id)).toBe(false);
        expect(orgIds.has(deadSector.id)).toBe(false);
        expect(orgIds.has(underDead.id)).toBe(false);

        // Inactive users, inactive positions and orgs under an inactive
        // ancestor are dropped; an inactive home region is blanked.
        expect(result.leaders.filter((l) => l.userId === gone.id)).toEqual([]);
        expect(result.leaders.some((l) => l.id === retired.id)).toBe(false);
        expect(result.leaders.filter((l) => l.userId === leader.id)).toEqual([
          {
            orgId: region.id,
            kind: "position",
            id: position.id,
            title: position.name,
            userId: leader.id,
            f3Name: "Away Leader",
            avatarUrl: null,
            homeRegionName: null,
          },
        ]);
      } finally {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(
            inArray(schema.positionsXOrgsXUsers.positionId, [
              position.id,
              retired.id,
            ]),
          );
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, gone.id));
        await db
          .delete(schema.positions)
          .where(inArray(schema.positions.id, [position.id, retired.id]));
        await cleanup.user(leader.id);
        await cleanup.user(gone.id);
      }
    });
  });

  describe("aos", () => {
    it("returns matching active AOs with their region and busiest location", async () => {
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

      const client = createTestClient();
      // ao.name is unique (contains a uniqueId), so it matches only this AO.
      const result = await client.orgChart.aos({ searchTerm: ao.name });

      const hit = result.aos.find((a) => a.id === ao.id);
      expect(hit).toBeDefined();
      if (!hit) {
        throw new Error("Expected the AO in search results");
      }
      expect(hit.regionId).toBe(region.id);
      expect(hit.locationId).toBe(location.id);
      expect(hit.eventCount).toBe(1);
    });

    it("prefers the busiest location when an AO has events at multiple locations", async () => {
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

      const quietLocation = await createLocation(region.id);
      const busyLocation = await createLocation(region.id);
      if (!quietLocation || !busyLocation) {
        return;
      }

      await createEvent({ orgId: ao.id, locationId: quietLocation.id });
      await createEvent({ orgId: ao.id, locationId: busyLocation.id });
      await createEvent({ orgId: ao.id, locationId: busyLocation.id });

      const client = createTestClient();
      const result = await client.orgChart.aos({ searchTerm: ao.name });

      const hit = result.aos.find((a) => a.id === ao.id);
      expect(hit).toBeDefined();
      expect(hit?.locationId).toBe(busyLocation.id);
      expect(hit?.eventCount).toBe(2);
    });

    it("excludes AOs with no active events and rejects short queries", async () => {
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
      if (!ao) {
        return;
      }

      const client = createTestClient();
      // No events created for this AO → it must not appear.
      const result = await client.orgChart.aos({ searchTerm: ao.name });
      expect(result.aos.find((a) => a.id === ao.id)).toBeUndefined();

      await expect(client.orgChart.aos({ searchTerm: "a" })).rejects.toThrow();
    });
  });

  describe("byLocation", () => {
    it("throws when the location is missing or inactive", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      await expect(
        client.orgChart.byLocation({ locationId: 999999999 }),
      ).rejects.toThrow();
    });

    it("returns an empty aos array for a location with no active AO events", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const region = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
      if (!region) {
        return;
      }
      const location = await createLocation(region.id);
      if (!location) {
        return;
      }

      const client = createTestClient();
      const result = await client.orgChart.byLocation({
        locationId: location.id,
      });

      expect(result.locationId).toBe(location.id);
      expect(result.aos).toEqual([]);
    });

    it("groups leadership positions by org for AOs at the location", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const nation = await getOrCreateF3NationOrg();
      const region = await createOrg({
        orgType: "region",
        parentId: nation.id,
      });
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

      const [user] = await db
        .insert(schema.users)
        .values({
          email: `test-${uniqueId()}@example.com`,
          f3Name: "Test Leader",
        })
        .returning();
      const [position] = await db
        .insert(schema.positions)
        .values({
          name: `Test Position ${uniqueId()}`,
          orgId: ao.id,
          isActive: true,
        })
        .returning();
      if (!user || !position) {
        throw new Error("Failed to create user/position fixtures");
      }
      await db.insert(schema.positionsXOrgsXUsers).values({
        positionId: position.id,
        orgId: ao.id,
        userId: user.id,
      });

      try {
        const client = createTestClient();
        const result = await client.orgChart.byLocation({
          locationId: location.id,
        });

        const hit = result.aos.find((a) => a.id === ao.id);
        expect(hit).toBeDefined();
        expect(hit?.positions).toHaveLength(1);
        expect(hit?.positions[0]?.userId).toBe(user.id);
        expect(hit?.positions[0]?.title).toBe(position.name);
      } finally {
        await db
          .delete(schema.positionsXOrgsXUsers)
          .where(eq(schema.positionsXOrgsXUsers.positionId, position.id));
        await db
          .delete(schema.positions)
          .where(eq(schema.positions.id, position.id));
        await cleanup.user(user.id);
      }
    });
  });
});
