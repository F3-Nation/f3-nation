/**
 * Tests for Event Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());
const mockMaybeNotifyFirstEventForRegion = vi.hoisted(() => vi.fn());
const mockMaybeNotifyRegionInABox = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

vi.mock("../lib/first-event-service", () => ({
  maybeNotifyFirstEventForRegion: mockMaybeNotifyFirstEventForRegion,
  maybeNotifyRegionInABox: mockMaybeNotifyRegionInABox,
}));

import { eq, inArray, schema, sql } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { waitForEventRegionNotificationTasks } from "./event";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

/** Returns the YYYY-MM-DD date string for the nth upcoming Monday (UTC). n=1 is next Monday. */
const nextFutureMonday = (n: number): string => {
  const d = new Date();
  const daysUntilNextMonday = (1 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilNextMonday + (n - 1) * 7);
  return d.toISOString().split("T")[0]!;
};

describe("Event Router", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdEventTypeIds: number[] = [];
  const createdEventTagIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeNotifyFirstEventForRegion.mockResolvedValue(undefined);
    mockMaybeNotifyRegionInABox.mockResolvedValue(undefined);
    // Reset rate limiter to allow requests
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(
    async () => {
      // Clean up in reverse order, respecting FK constraints
      for (const eventId of createdEventIds.reverse()) {
        try {
          await cleanup.event(eventId);
        } catch {
          // Ignore errors during cleanup
        }
      }
      for (const userId of createdUserIds.reverse()) {
        try {
          await cleanup.user(userId);
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
            .delete(schema.eventTagsXEvents)
            .where(eq(schema.eventTagsXEvents.eventTagId, eventTagId));
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
          await cleanup.org(orgId);
        } catch {
          // Ignore errors during cleanup
        }
      }
    },
    30000, // 30 second timeout for cleanup
  );

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

  // Helper to create test event type
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
      .values({ name: `Test Event Tag ${uniqueId()}`, isActive: true })
      .returning();
    if (eventTag) createdEventTagIds.push(eventTag.id);
    return eventTag;
  };

  const createScopedEventTag = async (
    specificOrgId: number,
    isActive = true,
  ) => {
    const [eventTag] = await db
      .insert(schema.eventTags)
      .values({
        name: `Scoped Event Tag ${uniqueId()}`,
        specificOrgId,
        isActive,
      })
      .returning();
    if (eventTag) createdEventTagIds.push(eventTag.id);
    return eventTag;
  };

  describe.each(["event", "map.event"] as const)(
    "%s.all cross-region events",
    (routerName) => {
      const prefix = `Cross-region ${uniqueId()}`;
      const client = createTestClient();
      const all =
        routerName === "event" ? client.event.all : client.map.event.all;
      let regions: Record<
        "alpha" | "bravo" | "charlie" | "zulu" | "unrelated",
        {
          id: number;
          name: string;
        }
      >;
      let events: {
        id: number;
        name: string;
      }[];
      let expectedRegions: { regionId: number; regionName: string }[][];
      let eventTypeIds: number[];

      beforeAll(async () => {
        const nation = await getOrCreateF3NationOrg();
        const insertRegion = async (name: string) => {
          const [region] = await db
            .insert(schema.orgs)
            .values({
              name,
              orgType: "region",
              parentId: nation.id,
              isActive: true,
            })
            .returning({ id: schema.orgs.id, name: schema.orgs.name });
          if (!region) throw new Error("Failed to create cross-region region");
          createdOrgIds.push(region.id);
          return region;
        };
        regions = {
          alpha: await insertRegion(`${prefix} Alpha`),
          bravo: await insertRegion(`${prefix} Bravo`),
          charlie: await insertRegion(`${prefix} Charlie`),
          zulu: await insertRegion(`${prefix} Zulu`),
          unrelated: await insertRegion(`${prefix} Unrelated`),
        };
        const alphaAO = await createTestAO(regions.alpha.id);
        const bravoAO = await createTestAO(regions.bravo.id);
        const charlieAO = await createTestAO(regions.charlie.id);
        const regionlessAO = await createTestAO(nation.id);
        const alphaLocation = await createTestLocation(regions.alpha.id);
        const bravoLocation = await createTestLocation(regions.bravo.id);
        const zuluLocation = await createTestLocation(regions.zulu.id);
        if (
          !alphaAO ||
          !bravoAO ||
          !charlieAO ||
          !regionlessAO ||
          !alphaLocation ||
          !bravoLocation ||
          !zuluLocation
        ) {
          throw new Error("Failed to create cross-region AOs and locations");
        }

        // Direct inserts represent legacy/moved events; new cross-region placements are rejected by crupdate.
        const placements = [
          { orgId: bravoAO.id, locationId: zuluLocation.id },
          { orgId: alphaAO.id, locationId: zuluLocation.id },
          { orgId: charlieAO.id, locationId: alphaLocation.id },
          { orgId: bravoAO.id, locationId: bravoLocation.id },
          { orgId: charlieAO.id, locationId: null },
          { orgId: alphaAO.id, locationId: alphaLocation.id },
          { orgId: regionlessAO.id, locationId: null },
        ];
        events = await db
          .insert(schema.events)
          .values(
            placements.map((placement, index) => ({
              ...placement,
              name: `${prefix} Event ${index}`,
              dayOfWeek: "monday" as const,
              startTime: "0530",
              startDate: "2026-01-01",
              isActive: true,
              isPrivate: false,
              highlight: false,
              email: "cross-region-contact@example.com",
            })),
          )
          .returning({ id: schema.events.id, name: schema.events.name });
        createdEventIds.push(...events.map(({ id }) => id));
        if (events.length !== 7)
          throw new Error("Failed to create all cross-region events");
        events.sort((a, b) => a.id - b.id);
        expectedRegions = [
          [regions.bravo, regions.zulu],
          [regions.alpha, regions.zulu],
          [regions.alpha, regions.charlie],
          [regions.bravo],
          [regions.charlie],
          [regions.alpha],
          [],
        ].map((group) =>
          group.map(({ id, name }) => ({ regionId: id, regionName: name })),
        );

        const firstType = await createTestEventType();
        const secondType = await createTestEventType();
        if (!firstType || !secondType)
          throw new Error("Failed to create event types");
        eventTypeIds = [firstType.id, secondType.id].sort((a, b) => a - b);
        await db.insert(schema.eventsXEventTypes).values(
          eventTypeIds.map((eventTypeId) => ({
            eventId: events[1]!.id,
            eventTypeId,
          })),
        );
      });

      beforeEach(async () => {
        await mockAuthWithSession(await createAdminSession());
      });

      it("returns each event once with complete region associations and ordinary location behavior", async () => {
        const result = await all({
          searchTerm: prefix,
          sorting: [],
          pageSize: 50,
        });
        expect.soft(result.totalCount).toBe(7);
        expect
          .soft(result.events.map(({ id }) => id))
          .toEqual(events.map(({ id }) => id));
        for (const [index, event] of events.entries()) {
          const matches = result.events.filter(({ id }) => id === event.id);
          expect.soft(matches).toHaveLength(1);
          for (const match of matches) {
            expect
              .soft([...match.regions].sort((a, b) => a.regionId - b.regionId))
              .toEqual(
                [...expectedRegions[index]!].sort(
                  (a, b) => a.regionId - b.regionId,
                ),
              );
          }
        }
        const crossRegion = result.events.find(
          ({ id }) => id === events[1]!.id,
        );
        expect(crossRegion).toBeDefined();
        expect(
          crossRegion!.eventTypes
            .map(({ eventTypeId }) => eventTypeId)
            .sort((a, b) => a - b),
        ).toEqual(eventTypeIds);
        const withoutLocation = result.events.find(
          ({ id }) => id === events[4]!.id,
        );
        expect(withoutLocation).toMatchObject({
          locationId: null,
          locationName: null,
          location: null,
        });
        const aligned = result.events.find(({ id }) => id === events[3]!.id);
        expect(aligned?.locationId).toEqual(expect.any(Number));
        expect(aligned?.regions).toEqual(expectedRegions[3]);
        expect(
          result.events.find(({ id }) => id === events[6]!.id),
        ).toMatchObject({ regions: [], locationId: null });
      });

      it("filters by either region without trimming associations or changing the region sort key", async () => {
        const cases = [
          {
            regionIds: [regions.alpha.id],
            expected: [events[1]!.id, events[2]!.id, events[5]!.id],
          },
          {
            regionIds: [regions.zulu.id],
            expected: [events[0]!.id, events[1]!.id],
          },
          {
            regionIds: [regions.alpha.id, regions.zulu.id],
            expected: [
              events[0]!.id,
              events[1]!.id,
              events[2]!.id,
              events[5]!.id,
            ],
          },
          { regionIds: [regions.unrelated.id], expected: [] },
        ];
        for (const { regionIds, expected } of cases) {
          const result = await all({
            searchTerm: prefix,
            regionIds,
            sorting: [],
            pageSize: 50,
          });
          expect.soft(result.totalCount).toBe(expected.length);
          expect.soft(result.events.map(({ id }) => id)).toEqual(expected);
          for (const event of result.events) {
            const index = events.findIndex(({ id }) => id === event.id);
            expect(index).toBeGreaterThanOrEqual(0);
            expect
              .soft([...event.regions].sort((a, b) => a.regionId - b.regionId))
              .toEqual(
                [...expectedRegions[index]!].sort(
                  (a, b) => a.regionId - b.regionId,
                ),
              );
          }
          expect
            .soft(
              (await client.event.count({ searchTerm: prefix, regionIds }))
                .count,
            )
            .toBe(expected.length);
        }
        for (const desc of [false, true]) {
          const result = await all({
            searchTerm: prefix,
            regionIds: [regions.zulu.id],
            sorting: [{ id: "regions", desc }],
            pageSize: 50,
          });
          expect
            .soft(result.events.map(({ id }) => id))
            .toEqual(
              desc
                ? [events[0]!.id, events[1]!.id]
                : [events[1]!.id, events[0]!.id],
            );
        }
      });

      it("paginates unique events with counts and stable first-region sorting in either direction", async () => {
        const cases = [
          { sorting: [], indexes: [0, 1, 2, 3, 4, 5, 6] },
          {
            sorting: [{ id: "regions", desc: false }],
            indexes: [1, 2, 5, 0, 3, 4, 6],
          },
          {
            sorting: [{ id: "regions", desc: true }],
            indexes: [6, 4, 0, 3, 1, 2, 5],
          },
        ];
        for (const { sorting, indexes } of cases) {
          for (const pageSize of [2, 4]) {
            const ids: number[] = [];
            for (
              let pageIndex = 0;
              pageIndex < Math.ceil(events.length / pageSize);
              pageIndex++
            ) {
              const page = await all({
                searchTerm: prefix,
                sorting,
                pageSize,
                pageIndex,
              });
              expect.soft(page.totalCount).toBe(7);
              expect
                .soft(page.events)
                .toHaveLength(
                  Math.min(pageSize, events.length - pageIndex * pageSize),
                );
              ids.push(...page.events.map(({ id }) => id));
            }
            expect.soft(ids).toEqual(indexes.map((index) => events[index]!.id));
            expect.soft(new Set(ids).size).toBe(7);
            const afterLastPage = await all({
              searchTerm: prefix,
              sorting,
              pageSize,
              pageIndex: Math.ceil(events.length / pageSize),
            });
            expect.soft(afterLastPage.events).toEqual([]);
            expect.soft(afterLastPage.totalCount).toBe(7);
          }
        }
      });

      it("preserves editable scope and combined-filter eligibility while returning complete associations", async () => {
        await getOrCreateRoles();
        const [editorRole] = await db
          .select({ id: schema.roles.id })
          .from(schema.roles)
          .where(eq(schema.roles.name, "editor"));
        if (!editorRole) throw new Error("Editor role not found");
        const [editor] = await db
          .insert(schema.users)
          .values({
            email: `cross-region-${uniqueId()}@example.com`,
            f3Name: "Cross Region Editor",
          })
          .returning();
        if (!editor) throw new Error("Failed to create scoped editor");
        createdUserIds.push(editor.id);
        await db.insert(schema.rolesXUsersXOrg).values({
          userId: editor.id,
          orgId: regions.zulu.id,
          roleId: editorRole.id,
        });
        const session = createEditorSession({
          orgId: regions.zulu.id,
          orgName: regions.zulu.name,
        });
        session.id = editor.id;
        session.user!.id = String(editor.id);
        await mockAuthWithSession(session);

        const visible = await all({
          searchTerm: prefix,
          onlyMine: true,
          sorting: [],
          pageSize: 50,
        });
        expect.soft(visible.totalCount).toBe(2);
        expect
          .soft(visible.events.map(({ id }) => id))
          .toEqual([events[0]!.id, events[1]!.id]);
        for (const event of visible.events) {
          const index = events.findIndex(({ id }) => id === event.id);
          expect(index).toBeGreaterThanOrEqual(0);
          expect
            .soft([...event.regions].sort((a, b) => a.regionId - b.regionId))
            .toEqual(
              [...expectedRegions[index]!].sort(
                (a, b) => a.regionId - b.regionId,
              ),
            );
        }
        const conflictingFilter = await all({
          searchTerm: prefix,
          onlyMine: true,
          regionIds: [regions.alpha.id],
          pageSize: 50,
        });
        expect
          .soft(conflictingFilter)
          .toMatchObject({ totalCount: 0, events: [] });
        const matchingFilter = await all({
          searchTerm: prefix,
          onlyMine: true,
          regionIds: [regions.zulu.id],
          sorting: [],
          pageSize: 50,
        });
        expect
          .soft(matchingFilter.events.map(({ id }) => id))
          .toEqual([events[0]!.id, events[1]!.id]);
      });

      if (routerName === "event") {
        it("preserves anonymous visibility and email redaction for cross-region events", async () => {
          const [placement] = await db
            .select({
              orgId: schema.events.orgId,
              locationId: schema.events.locationId,
            })
            .from(schema.events)
            .where(eq(schema.events.id, events[1]!.id));
          if (!placement) throw new Error("Cross-region event not found");
          const inactiveLocation = await createTestLocation(regions.zulu.id);
          if (!inactiveLocation)
            throw new Error("Failed to create inactive location");
          await db
            .update(schema.locations)
            .set({ isActive: false })
            .where(eq(schema.locations.id, inactiveLocation.id));
          const base = {
            ...placement,
            dayOfWeek: "monday" as const,
            startTime: "0530",
            startDate: "2026-01-01",
            isActive: true,
            isPrivate: false,
            highlight: false,
            email: "cross-region-hidden@example.com",
          };
          const hiddenEvents = await db
            .insert(schema.events)
            .values([
              { ...base, name: `${prefix} Private`, isPrivate: true },
              { ...base, name: `${prefix} Inactive`, isActive: false },
              {
                ...base,
                name: `${prefix} Inactive location`,
                locationId: inactiveLocation.id,
              },
            ])
            .returning({ id: schema.events.id });
          createdEventIds.push(...hiddenEvents.map(({ id }) => id));
          expect(hiddenEvents).toHaveLength(3);

          try {
            await mockAuthWithSession(null);
            const anonymous = await all({
              searchTerm: prefix,
              statuses: ["active", "inactive"],
              sorting: [],
              pageSize: 50,
            });
            expect.soft(anonymous.totalCount).toBe(7);
            expect
              .soft(anonymous.events.map(({ id }) => id))
              .toEqual(events.map(({ id }) => id));
            for (const event of anonymous.events) {
              const index = events.findIndex(({ id }) => id === event.id);
              expect(index).toBeGreaterThanOrEqual(0);
              expect.soft(event.email).toBeNull();
              expect
                .soft(
                  [...event.regions].sort((a, b) => a.regionId - b.regionId),
                )
                .toEqual(
                  [...expectedRegions[index]!].sort(
                    (a, b) => a.regionId - b.regionId,
                  ),
                );
            }
            await expect(
              client.map.event.all({ searchTerm: prefix, pageSize: 50 }),
            ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

            await mockAuthWithSession(await createAdminSession());
            const signedIn = await all({
              searchTerm: prefix,
              statuses: ["active", "inactive"],
              sorting: [],
              pageSize: 50,
            });
            expect.soft(signedIn.totalCount).toBe(10);
            expect
              .soft(signedIn.events.map(({ id }) => id))
              .toEqual(
                [...events, ...hiddenEvents]
                  .map(({ id }) => id)
                  .sort((a, b) => a - b),
              );
            expect
              .soft(
                signedIn.events.find(({ id }) => id === events[1]!.id)?.email,
              )
              .toBe("cross-region-contact@example.com");
          } finally {
            for (const { id } of hiddenEvents) await cleanup.event(id);
          }
        });
      }
    },
  );

  it.each(["event", "map.event"] as const)(
    "%s.all provides stable pagination for tied values and preserves sort precedence",
    async (routerName) => {
      await mockAuthWithSession(await createAdminSession());
      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create test region");
      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");
      const prefix = `Pagination ${uniqueId()}`;
      const events = await db
        .insert(schema.events)
        .values(
          Array.from({ length: 40 }, (_, index) => ({
            name: `${prefix} ${index % 2 ? "Alpha" : "Zulu"}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday" as const,
            startTime: "0530",
            isActive: index % 4 < 2,
            isPrivate: false,
            highlight: false,
            startDate: "2026-01-01",
          })),
        )
        .returning({
          id: schema.events.id,
          name: schema.events.name,
          isActive: schema.events.isActive,
        });
      createdEventIds.push(...events.map((event) => event.id));
      // Move a tied tuple so physical row order cannot stand in for ID order.
      await db
        .update(schema.events)
        .set({ name: sql`${schema.events.name}` })
        .where(eq(schema.events.id, events[0]!.id));

      const byId = [...events].sort((a, b) => a.id - b.id);
      const cases: {
        sorting: { id: string; desc: boolean }[] | undefined;
        expected: number[];
      }[] = [
        { sorting: [], expected: byId.map((event) => event.id) },
        {
          sorting: undefined,
          expected: byId.map((event) => event.id).reverse(),
        },
        {
          sorting: [
            { id: "parent", desc: false },
            { id: "id", desc: true },
          ],
          expected: byId.map((event) => event.id).reverse(),
        },
      ];
      for (const desc of [false, true]) {
        const fields =
          routerName === "map.event"
            ? ["parent", "status", "name"]
            : ["parent", "status"];
        for (const id of fields) {
          cases.push({
            sorting: [{ id, desc }],
            expected: [...byId]
              .sort((a, b) => {
                const primary =
                  id === "status"
                    ? Number(a.isActive) - Number(b.isActive)
                    : id === "name"
                      ? a.name < b.name
                        ? -1
                        : a.name > b.name
                          ? 1
                          : 0
                      : 0;
                return primary * (desc ? -1 : 1);
              })
              .map((event) => event.id),
          });
        }
      }

      const client = createTestClient();
      const all =
        routerName === "event" ? client.event.all : client.map.event.all;
      for (const { sorting, expected } of cases) {
        for (const pageSize of [5, 7]) {
          const paged: number[] = [];
          for (
            let pageIndex = 0;
            pageIndex < Math.ceil(40 / pageSize);
            pageIndex++
          ) {
            const page = await all({
              searchTerm: prefix,
              statuses: ["active", "inactive"],
              sorting,
              pageIndex,
              pageSize,
            });
            expect(page.totalCount).toBe(40);
            paged.push(...page.events.map((event) => event.id));
          }
          const context = `${routerName}.all sorting=${JSON.stringify(sorting)}, pageSize=${pageSize}`;
          expect
            .soft({ context, ids: paged })
            .toEqual({ context, ids: expected });
          expect.soft({ context, uniqueCount: new Set(paged).size }).toEqual({
            context,
            uniqueCount: 40,
          });
        }
      }
    },
  );

  describe("all", () => {
    it("should include events without a location (locationId null)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      // Create an event with no location
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `No Location Event ${uniqueId()}`,
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

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.some((e) => e.id === created?.id)).toBe(true);
    });
  });

  describe("map.event.all", () => {
    it("should return a list of events with filtering", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const [created] = await db
        .insert(schema.events)
        .values({
          name: `MapFilterEvent ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.length).toBeGreaterThanOrEqual(1);
      expect(result.events?.length).toBeLessThanOrEqual(50);
    });

    it("should include events without a location (locationId null)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) throw new Error("Failed to create region");

      const ao = await createTestAO(region.id);
      if (!ao) throw new Error("Failed to create test AO");

      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Map No Location Event ${uniqueId()}`,
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

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        aoIds: [ao.id],
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      const rovingEvent = result.events?.find((e) => e.id === created?.id);
      expect(rovingEvent).toBeDefined();
      expect(rovingEvent?.locationId).toBeNull();
      expect(rovingEvent?.locationName).toBeNull();
      expect(rovingEvent?.location).toBeNull();
    });

    it("should return response shape without pre-existing data", async () => {
      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 50,
        statuses: ["active"],
      });

      expect(result.events?.length).toBeGreaterThan(0);
    });
  });

  describe("map.event.all pagination", () => {
    it("should return a list of events with filtering", async () => {
      const client = createTestClient();
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.events)).toBe(true);
    });

    it("should paginate results correctly", async () => {
      const client = createTestClient();
      const page1 = await client.map.event.all({
        pageIndex: 0,
        pageSize: 2,
      });

      const page2 = await client.map.event.all({
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.events?.length).toBeLessThanOrEqual(2);
      expect(page2.events?.length).toBeLessThanOrEqual(2);

      // Results should be different if there are more than 2 events
      if (
        page1.totalCount > 2 &&
        (page1.events?.length ?? 0) > 0 &&
        (page2.events?.length ?? 0) > 0
      ) {
        expect(page1.events?.[0]?.id).not.toBe(page2.events?.[0]?.id);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeEvents = await client.map.event.all({
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeEvents.events?.every((e) => e.isActive === true)).toBe(true);
    });

    it("should search by name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event with unique name
      const uniqueName = `SearchableEvent ${uniqueId()}`;
      const [created] = await db
        .insert(schema.events)
        .values({
          name: uniqueName,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        searchTerm: "SearchableEvent",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should include our created event
      const found = result.events?.some((e) => e.id === created?.id);
      expect(found).toBe(true);
    });

    it("should filter by region", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event in this region
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Region Filter Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.map.event.all({
        regionIds: [region.id],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("events");
      // Our event should be in the results
      const found = result.events?.some((e) => e.id === created?.id);
      expect(found).toBe(true);
    });

    it("should return isPrivate field for events", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a public event
      const [publicEvent] = await db
        .insert(schema.events)
        .values({
          name: `Public Event ${uniqueId()}`,
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

      // Create a private event
      const [privateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Private Event ${uniqueId()}`,
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
      const result = await client.map.event.all({
        pageIndex: 0,
        pageSize: 100,
      });

      // Find our events in the results
      const foundPublic = result.events?.find((e) => e.id === publicEvent?.id);
      const foundPrivate = result.events?.find(
        (e) => e.id === privateEvent?.id,
      );

      // Both events should have isPrivate field
      expect(foundPublic).toBeDefined();
      expect(foundPublic?.isPrivate).toBe(false);

      expect(foundPrivate).toBeDefined();
      expect(foundPrivate?.isPrivate).toBe(true);
    });

    it("should filter by eventTypeNames", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a unique event type
      const uniqueTypeName = `UniqueType ${uniqueId()}`;
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: uniqueTypeName,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      // Create an event with this event type
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Event Type Filter Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!created) return;
      createdEventIds.push(created.id);

      // Link event to event type
      await db.insert(schema.eventsXEventTypes).values({
        eventId: created.id,
        eventTypeId: eventType.id,
      });

      const client = createTestClient();
      const result = await client.map.event.all({
        eventTypeNames: [uniqueTypeName],
        pageIndex: 0,
        pageSize: 100,
      });

      // Our event should be in the results
      const found = result.events?.some((e) => e.id === created.id);
      expect(found).toBe(true);

      // All returned events should have an eventType matching our filter
      result.events?.forEach((event) => {
        const hasMatchingType = event.eventTypes.some(
          (et) => et.eventTypeName === uniqueTypeName,
        );
        expect(hasMatchingType).toBe(true);
      });
    });

    it("should filter by eventCategories", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create event types for different categories
      const [thirdFType] = await db
        .insert(schema.eventTypes)
        .values({
          name: `Third F Type ${uniqueId()}`,
          eventCategory: "third_f",
          isActive: true,
        })
        .returning();

      if (!thirdFType) return;
      createdEventTypeIds.push(thirdFType.id);

      // Create an event with third_f category
      const [thirdFEvent] = await db
        .insert(schema.events)
        .values({
          name: `Third F Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "1800",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!thirdFEvent) return;
      createdEventIds.push(thirdFEvent.id);

      // Link event to event type
      await db.insert(schema.eventsXEventTypes).values({
        eventId: thirdFEvent.id,
        eventTypeId: thirdFType.id,
      });

      const client = createTestClient();
      const result = await client.map.event.all({
        eventCategories: ["third_f"],
        pageIndex: 0,
        pageSize: 100,
      });

      // Our third_f event should be in the results
      const found = result.events?.some((e) => e.id === thirdFEvent.id);
      expect(found).toBe(true);

      // All returned events should have third_f category
      result.events?.forEach((event) => {
        const hasThirdF = event.eventTypes.some(
          (et) => et.eventCategory === "third_f",
        );
        expect(hasThirdF).toBe(true);
      });
    });
  });

  describe("count", () => {
    it("should return a count of events", async () => {
      const client = createTestClient();
      const result = await client.event.count();

      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it("should return count matching status filter", async () => {
      const client = createTestClient();

      // Get count of active events
      const activeCount = await client.event.count({
        statuses: ["active"],
      });

      // Get count of inactive events
      const inactiveCount = await client.event.count({
        statuses: ["inactive"],
      });

      // Get count of all events (active + inactive)
      const allCount = await client.event.count({
        statuses: ["active", "inactive"],
      });

      expect(activeCount.count).toBeGreaterThanOrEqual(0);
      expect(inactiveCount.count).toBeGreaterThanOrEqual(0);
      // Active + inactive should approximately equal all
      // Note: Due to concurrent test execution, counts may vary slightly between queries
      const sum = activeCount.count + inactiveCount.count;
      expect(Math.abs(sum - allCount.count)).toBeLessThanOrEqual(2);
    });

    it("should return count matching eventTypeNames filter", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a unique event type
      const uniqueTypeName = `CountTestType ${uniqueId()}`;
      const [eventType] = await db
        .insert(schema.eventTypes)
        .values({
          name: uniqueTypeName,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();

      if (!eventType) return;
      createdEventTypeIds.push(eventType.id);

      // Create events with this event type
      const eventsToCreate = 3;
      for (let i = 0; i < eventsToCreate; i++) {
        const [created] = await db
          .insert(schema.events)
          .values({
            name: `Count Test Event ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            isActive: true,
            highlight: false,
            startDate: "2026-01-01",
          })
          .returning();

        if (created) {
          createdEventIds.push(created.id);
          await db.insert(schema.eventsXEventTypes).values({
            eventId: created.id,
            eventTypeId: eventType.id,
          });
        }
      }

      const client = createTestClient();
      const result = await client.event.count({
        eventTypeNames: [uniqueTypeName],
      });

      // Should have at least the events we created
      expect(result.count).toBeGreaterThanOrEqual(eventsToCreate);
    });

    it("should return count matching eventCategories filter", async () => {
      const client = createTestClient();

      const result = await client.event.count({
        eventCategories: ["first_f"],
      });

      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it("should return count matching region filter", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event in this region
      const [created] = await db
        .insert(schema.events)
        .values({
          name: `Region Count Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (created) {
        createdEventIds.push(created.id);
      }

      const client = createTestClient();
      const result = await client.event.count({
        regionIds: [region.id],
      });

      // Should have at least 1 event in this region
      expect(result.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("byId", () => {
    it("should return an event by ID", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a test event
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `ById Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0545",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      const client = createTestClient();
      const result = await client.event.byId({
        id: testEvent.id,
      });

      expect(result).toHaveProperty("event");
      expect(result.event).not.toBeNull();
      expect(result.event?.id).toBe(testEvent.id);
    });

    it("should return null for non-existent event", async () => {
      const client = createTestClient();
      const result = await client.event.byId({
        id: 999999,
      });

      expect(result.event).toBeNull();
    });

    it("should hide an active, non-private event at an inactive location from an anonymous caller, but not from a signed-in caller", async () => {
      // The test harness defaults to a signed-in admin session; a prior
      // test case may have left the auth mock on a specific session too,
      // so explicitly reset to anonymous before the "anonymous" assertions.
      await mockAuthWithSession(null);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Deleted Location ById Event ${uniqueId()}`,
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
      if (!event) return;
      createdEventIds.push(event.id);

      // location.delete only soft-deletes the location (isActive: false)
      await db
        .update(schema.locations)
        .set({ isActive: false })
        .where(eq(schema.locations.id, location.id));

      const anonymousClient = createTestClient();
      const anonymousResult = await anonymousClient.event.byId({
        id: event.id,
      });
      expect(anonymousResult.event).toBeNull();

      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const signedInClient = createTestClient();
      const signedInResult = await signedInClient.event.byId({
        id: event.id,
      });
      expect(signedInResult.event?.id).toBe(event.id);
    });

    it("should return isPrivate field for an event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create a private event
      const [privateEvent] = await db
        .insert(schema.events)
        .values({
          name: `Private ById Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0545",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
          isPrivate: true,
        })
        .returning();

      if (!privateEvent) return;
      createdEventIds.push(privateEvent.id);

      const client = createTestClient();
      const result = await client.event.byId({
        id: privateEvent.id,
      });

      expect(result.event).not.toBeNull();
      expect(result.event?.id).toBe(privateEvent.id);
      expect(result.event?.isPrivate).toBe(true);
    });
  });

  describe("crupdate", () => {
    it("soft deletes future instances without recreating them on deactivation", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(region.id);
      if (!location) return;
      const eventType = await createTestEventType();
      const updatedEventType = await createTestEventType();
      if (!eventType || !updatedEventType) return;

      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const createSeries = async (name: string) => {
        const [series] = await db
          .insert(schema.events)
          .values({
            name,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2020-01-06",
            endDate: null,
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!series) throw new Error("Failed to create test series");
        createdEventIds.push(series.id);
        return series;
      };

      const insertInstance = async (
        seriesId: number,
        startDate: string,
        name: string,
      ) => {
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate,
            isActive: true,
            highlight: false,
            seriesId,
            isPrivate: false,
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        return instance;
      };

      const series = await createSeries(`Status Cascade ${uniqueId()}`);
      const pastInstance = await insertInstance(
        series.id,
        "2020-01-13",
        `Past instance ${uniqueId()}`,
      );
      const futureInstance = await insertInstance(
        series.id,
        nextFutureMonday(2),
        `Future instance ${uniqueId()}`,
      );
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureInstance.id,
        eventTypeId: eventType.id,
      });

      const unrelatedSeries = await createSeries(
        `Unrelated Series ${uniqueId()}`,
      );
      const unrelatedInstance = await insertInstance(
        unrelatedSeries.id,
        nextFutureMonday(3),
        `Unrelated instance ${uniqueId()}`,
      );

      const client = createTestClient();
      await client.event.crupdate({
        id: series.id,
        name: `${series.name} updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0545",
        endTime: "0630",
        // Deactivate without changing the series' structural schedule.
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: false,
        eventTypeIds: [updatedEventType.id],
        email: null,
      });

      const persistedInstances = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(
          inArray(schema.eventInstances.id, [
            pastInstance.id,
            futureInstance.id,
            unrelatedInstance.id,
          ]),
        );
      expect(persistedInstances).toHaveLength(3);
      expect(persistedInstances).toContainEqual({
        id: pastInstance.id,
        isActive: true,
      });
      expect(persistedInstances).toContainEqual({
        id: futureInstance.id,
        isActive: false,
      });
      const [updatedFutureDetails] = await db
        .select({
          name: schema.eventInstances.name,
          locationId: schema.eventInstances.locationId,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, futureInstance.id));
      expect(updatedFutureDetails).toEqual({
        name: `${series.name} updated`,
        locationId: location.id,
        startTime: "0545",
        endTime: "0630",
      });
      expect(persistedInstances).toContainEqual({
        id: unrelatedInstance.id,
        isActive: true,
      });
      const futureInstanceTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            futureInstance.id,
          ),
        );
      expect(futureInstanceTypes).toEqual([
        { eventTypeId: updatedEventType.id },
      ]);
    });

    it("does not cascade on inactive no-op or active-to-active status saves", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const fixtures = [];
      for (const isActive of [false, true]) {
        const [series] = await db
          .insert(schema.events)
          .values({
            name: `Status No-op ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2020-01-06",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            isActive,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!series) throw new Error("Failed to create test series");
        createdEventIds.push(series.id);
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Status No-op instance ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: series.id,
            isPrivate: false,
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        fixtures.push({ series, instance });
      }

      const client = createTestClient();
      for (const { series } of fixtures) {
        await client.event.crupdate({
          id: series.id,
          name: series.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: series.startDate,
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: series.isActive,
          eventTypeIds: [eventType.id],
          email: null,
        });
      }

      const instanceStatuses = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(
          inArray(
            schema.eventInstances.id,
            fixtures.map(({ instance }) => instance.id),
          ),
        );
      expect(instanceStatuses).toHaveLength(2);
      expect(instanceStatuses.every(({ isActive }) => isActive)).toBe(true);
    });

    it("reactivates existing instances from today onward without changing history", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(region.id);
      if (!location) return;
      const eventType = await createTestEventType();
      const updatedEventType = await createTestEventType();
      const eventTag = await createTestEventTag();
      if (!eventType || !eventTag || !updatedEventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Reactivated Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) throw new Error("Failed to create test series");
      createdEventIds.push(series.id);
      const [attendanceUser] = await db
        .insert(schema.users)
        .values({
          email: `series-reactivation-${uniqueId()}@example.com`,
          f3Name: `Series Reactivation ${uniqueId()}`,
        })
        .returning();
      if (!attendanceUser) throw new Error("Failed to create test user");
      createdUserIds.push(attendanceUser.id);

      const today = new Date().toISOString().split("T")[0]!;
      const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      const yesterday = yesterdayDate.toISOString().split("T")[0]!;
      const createInstance = async (params: {
        seriesId: number;
        startDate: string;
        isActive: boolean;
        seriesException?: "closed" | null;
      }) => {
        const [instance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Reactivation Instance ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate: params.startDate,
            isActive: params.isActive,
            highlight: false,
            seriesId: params.seriesId,
            isPrivate: false,
            seriesException: params.seriesException ?? null,
            paxCount: 7,
            preblast: "Existing preblast",
          })
          .returning();
        if (!instance) throw new Error("Failed to create test instance");
        return instance;
      };

      const past = await createInstance({
        seriesId: series.id,
        startDate: yesterday,
        isActive: false,
      });
      const todayInactive = await createInstance({
        seriesId: series.id,
        startDate: today,
        isActive: false,
        seriesException: "closed",
      });
      const futureInactive = await createInstance({
        seriesId: series.id,
        startDate: nextFutureMonday(2),
        isActive: false,
        seriesException: "closed",
      });
      const futureActive = await createInstance({
        seriesId: series.id,
        startDate: nextFutureMonday(3),
        isActive: true,
      });
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureInactive.id,
        eventTypeId: eventType.id,
      });
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: futureActive.id,
        eventTypeId: eventType.id,
      });
      await db.insert(schema.eventTagsXEventInstances).values({
        eventInstanceId: futureInactive.id,
        eventTagId: eventTag.id,
      });
      await db.insert(schema.attendance).values({
        userId: attendanceUser.id,
        eventInstanceId: futureInactive.id,
        isPlanned: false,
      });

      const [otherSeries] = await db
        .insert(schema.events)
        .values({
          name: `Unrelated Inactive Series ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!otherSeries) throw new Error("Failed to create unrelated series");
      createdEventIds.push(otherSeries.id);
      const otherInstance = await createInstance({
        seriesId: otherSeries.id,
        startDate: nextFutureMonday(4),
        isActive: false,
      });

      const client = createTestClient();
      await client.event.crupdate({
        id: series.id,
        name: `${series.name} updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "monday",
        startTime: "0545",
        endTime: "0630",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [updatedEventType.id],
        email: null,
      });

      const observed = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
          name: schema.eventInstances.name,
          locationId: schema.eventInstances.locationId,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
          seriesException: schema.eventInstances.seriesException,
          paxCount: schema.eventInstances.paxCount,
          preblast: schema.eventInstances.preblast,
        })
        .from(schema.eventInstances)
        .where(
          inArray(schema.eventInstances.id, [
            past.id,
            todayInactive.id,
            futureInactive.id,
            futureActive.id,
            otherInstance.id,
          ]),
        );
      expect(observed).toHaveLength(5);
      const seriesInstanceIds = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));
      expect(seriesInstanceIds.map(({ id }) => id).sort()).toEqual(
        [past.id, todayInactive.id, futureInactive.id, futureActive.id].sort(),
      );
      const byId = new Map(observed.map((instance) => [instance.id, instance]));
      expect(byId.get(past.id)).toMatchObject({
        id: past.id,
        isActive: false,
        seriesException: null,
      });
      expect(byId.get(todayInactive.id)).toMatchObject({
        id: todayInactive.id,
        isActive: true,
        seriesException: "closed",
        paxCount: 7,
        preblast: "Existing preblast",
      });
      expect(byId.get(futureInactive.id)).toMatchObject({
        id: futureInactive.id,
        isActive: true,
        name: `${series.name} updated`,
        locationId: location.id,
        startTime: "0545",
        endTime: "0630",
        seriesException: "closed",
        paxCount: 7,
        preblast: "Existing preblast",
      });
      expect(byId.get(futureActive.id)).toMatchObject({
        id: futureActive.id,
        isActive: true,
      });
      expect(byId.get(otherInstance.id)).toMatchObject({
        id: otherInstance.id,
        isActive: false,
      });

      const retainedEventTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            futureInactive.id,
          ),
        );
      const retainedTags = await db
        .select({ eventTagId: schema.eventTagsXEventInstances.eventTagId })
        .from(schema.eventTagsXEventInstances)
        .where(
          eq(
            schema.eventTagsXEventInstances.eventInstanceId,
            futureInactive.id,
          ),
        );
      expect(retainedEventTypes).toEqual([{ eventTypeId: eventType.id }]);
      const updatedOpenInstanceTypes = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(schema.eventInstancesXEventTypes.eventInstanceId, futureActive.id),
        );
      expect(updatedOpenInstanceTypes).toEqual([
        { eventTypeId: updatedEventType.id },
      ]);
      expect(retainedTags).toEqual([{ eventTagId: eventTag.id }]);
      const retainedAttendance = await db
        .select({ userId: schema.attendance.userId })
        .from(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, futureInactive.id));
      expect(retainedAttendance).toEqual([{ userId: attendanceUser.id }]);
    });

    it("preserves omitted metadata on reactivation and allows explicit metadata clearing", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const seriesMeta = { seriesKey: "series-value" };
      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Metadata reactivation ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
          meta: seriesMeta,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      await db.insert(schema.eventsXEventTypes).values({
        eventId: series.id,
        eventTypeId: eventType.id,
      });
      const instanceMeta = { instanceOverride: "keep-me" };
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: series.name,
          orgId: ao.id,
          locationId: null,
          startTime: series.startTime,
          endTime: series.endTime,
          startDate: nextFutureMonday(2),
          isActive: false,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
          meta: instanceMeta,
        })
        .returning();
      if (!instance) return;
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: instance.id,
        eventTypeId: eventType.id,
      });

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const [persistedSeries] = await db
        .select({ meta: schema.events.meta })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [persistedInstance] = await db
        .select({
          isActive: schema.eventInstances.isActive,
          meta: schema.eventInstances.meta,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(persistedSeries?.meta).toEqual(seriesMeta);
      expect(persistedInstance).toEqual({ isActive: true, meta: instanceMeta });

      await createTestClient().event.crupdate({
        id: series.id,
        name: series.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: series.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        meta: null,
        email: null,
      });

      const [clearedSeries] = await db
        .select({ meta: schema.events.meta })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [clearedInstance] = await db
        .select({ meta: schema.eventInstances.meta })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(clearedSeries?.meta).toBeNull();
      expect(clearedInstance?.meta).toBeNull();
    });

    it("requires admin permission to deactivate an existing event", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Editor Deactivation ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Editor Deactivation Instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: true,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) return;

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const error = await createTestClient()
        .event.crupdate({
          id: series.id,
          name: `Mutated ${series.name}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-13",
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: false,
          eventTypeIds: [eventType.id],
          email: null,
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toMatchObject({ code: "UNAUTHORIZED" });
      const [unchangedSeries] = await db
        .select({
          name: schema.events.name,
          startDate: schema.events.startDate,
          isActive: schema.events.isActive,
        })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      const [unchangedInstance] = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(unchangedSeries).toEqual({
        name: series.name,
        startDate: series.startDate,
        isActive: true,
      });
      expect(unchangedInstance).toEqual({ id: instance.id, isActive: true });
    });

    it.each([
      { storedIsActive: false, requestedIsActive: false },
      { storedIsActive: false, requestedIsActive: true },
      { storedIsActive: true, requestedIsActive: false },
      { storedIsActive: true, requestedIsActive: true },
    ])(
      "rejects converting an existing series to a one-off when active changes from $storedIsActive to $requestedIsActive",
      async ({ storedIsActive, requestedIsActive }) => {
        const region = await createTestRegion();
        if (!region) return;
        const ao = await createTestAO(region.id);
        if (!ao) return;
        const eventType = await createTestEventType();
        if (!eventType) return;
        const adminSession = await createAdminSession();
        if (adminSession.roles && adminSession.user?.roles) {
          adminSession.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
          adminSession.user.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
        }
        await mockAuthWithSession(adminSession);

        const [series] = await db
          .insert(schema.events)
          .values({
            name: `One-off conversion ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2020-01-06",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            isActive: storedIsActive,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!series) return;
        createdEventIds.push(series.id);
        const [obsoleteInstance] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Obsolete schedule instance ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: false,
            highlight: false,
            seriesId: series.id,
            isPrivate: false,
          })
          .returning();
        if (!obsoleteInstance) return;

        await db.insert(schema.eventsXEventTypes).values({
          eventId: series.id,
          eventTypeId: eventType.id,
        });

        const [attendanceUser] = await db
          .insert(schema.users)
          .values({
            email: `one-off-reject-${uniqueId()}@example.com`,
            f3Name: `One-off reject ${uniqueId()}`,
          })
          .returning();
        if (!attendanceUser) throw new Error("Failed to create test user");
        createdUserIds.push(attendanceUser.id);
        await db.insert(schema.eventInstancesXEventTypes).values({
          eventInstanceId: obsoleteInstance.id,
          eventTypeId: eventType.id,
        });
        await db.insert(schema.attendance).values({
          userId: attendanceUser.id,
          eventInstanceId: obsoleteInstance.id,
          isPlanned: false,
        });

        const error = await createTestClient()
          .event.crupdate({
            id: series.id,
            name: series.name,
            aoId: ao.id,
            regionId: region.id,
            locationId: null,
            dayOfWeek: null,
            startTime: "0530",
            endTime: "0615",
            startDate: series.startDate,
            endDate: null,
            recurrencePattern: null,
            recurrenceInterval: null,
            indexWithinInterval: null,
            highlight: false,
            isActive: requestedIsActive,
            eventTypeIds: [eventType.id],
            email: null,
          })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );
        expect(error).toMatchObject({ code: "BAD_REQUEST" });

        const [unchangedSeries] = await db
          .select({
            id: schema.events.id,
            name: schema.events.name,
            isActive: schema.events.isActive,
            dayOfWeek: schema.events.dayOfWeek,
            startDate: schema.events.startDate,
            recurrencePattern: schema.events.recurrencePattern,
          })
          .from(schema.events)
          .where(eq(schema.events.id, series.id));
        expect(unchangedSeries).toEqual({
          id: series.id,
          name: series.name,
          isActive: storedIsActive,
          dayOfWeek: "monday",
          startDate: series.startDate,
          recurrencePattern: "weekly",
        });
        const [preservedInstance] = await db
          .select({
            id: schema.eventInstances.id,
            name: schema.eventInstances.name,
            isActive: schema.eventInstances.isActive,
            startDate: schema.eventInstances.startDate,
            seriesId: schema.eventInstances.seriesId,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.id, obsoleteInstance.id));
        expect(preservedInstance).toEqual({
          id: obsoleteInstance.id,
          name: obsoleteInstance.name,
          isActive: false,
          startDate: obsoleteInstance.startDate,
          seriesId: series.id,
        });
        const [preservedType] = await db
          .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
          .from(schema.eventInstancesXEventTypes)
          .where(
            eq(
              schema.eventInstancesXEventTypes.eventInstanceId,
              obsoleteInstance.id,
            ),
          );
        expect(preservedType).toEqual({ eventTypeId: eventType.id });
        const [preservedAttendance] = await db
          .select({ userId: schema.attendance.userId })
          .from(schema.attendance)
          .where(eq(schema.attendance.eventInstanceId, obsoleteInstance.id));
        expect(preservedAttendance).toEqual({ userId: attendanceUser.id });
        const [preservedSeriesType] = await db
          .select({ eventTypeId: schema.eventsXEventTypes.eventTypeId })
          .from(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, series.id));
        expect(preservedSeriesType).toEqual({ eventTypeId: eventType.id });
      },
    );

    it("rejects structural schedule changes while deactivating an active series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Active series conversion ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Active future instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: true,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) return;

      const [attendanceUser] = await db
        .insert(schema.users)
        .values({
          email: `deactivation-reject-${uniqueId()}@example.com`,
          f3Name: `Deactivation reject ${uniqueId()}`,
        })
        .returning();
      if (!attendanceUser) throw new Error("Failed to create test user");
      createdUserIds.push(attendanceUser.id);
      await db.insert(schema.eventInstancesXEventTypes).values({
        eventInstanceId: instance.id,
        eventTypeId: eventType.id,
      });
      await db.insert(schema.attendance).values({
        userId: attendanceUser.id,
        eventInstanceId: instance.id,
        isPlanned: false,
      });

      const error = await createTestClient()
        .event.crupdate({
          id: series.id,
          name: series.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "tuesday",
          startTime: "0530",
          endTime: "0615",
          startDate: series.startDate,
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: false,
          eventTypeIds: [eventType.id],
          email: null,
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      const [persistedSeries] = await db
        .select({
          isActive: schema.events.isActive,
          dayOfWeek: schema.events.dayOfWeek,
        })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      expect(persistedSeries).toEqual({ isActive: true, dayOfWeek: "monday" });

      const [persisted] = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(persisted).toEqual({ id: instance.id, isActive: true });
      const [persistedType] = await db
        .select({ eventTypeId: schema.eventInstancesXEventTypes.eventTypeId })
        .from(schema.eventInstancesXEventTypes)
        .where(
          eq(schema.eventInstancesXEventTypes.eventInstanceId, instance.id),
        );
      expect(persistedType).toEqual({ eventTypeId: eventType.id });
      const [persistedAttendance] = await db
        .select({ userId: schema.attendance.userId })
        .from(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, instance.id));
      expect(persistedAttendance).toEqual({ userId: attendanceUser.id });
    });

    it("rejects structural schedule changes while reactivating an inactive series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Inactive series reactivation ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `Inactive series instance ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: false,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) return;

      const error = await createTestClient()
        .event.crupdate({
          id: series.id,
          name: series.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "tuesday",
          startTime: "0530",
          endTime: "0615",
          startDate: series.startDate,
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        })
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      const [persistedSeries] = await db
        .select({
          isActive: schema.events.isActive,
          dayOfWeek: schema.events.dayOfWeek,
        })
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      expect(persistedSeries).toEqual({ isActive: false, dayOfWeek: "monday" });

      const persistedInstances = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));
      expect(persistedInstances).toEqual([
        { id: instance.id, isActive: false },
      ]);
    });

    it("preserves existing instance IDs across status-only deactivation and reactivation", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const [series] = await db
        .insert(schema.events)
        .values({
          name: `Status-only series ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) throw new Error("Failed to create test series");
      createdEventIds.push(series.id);
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: series.name,
          orgId: ao.id,
          locationId: null,
          startTime: "0530",
          endTime: "0615",
          startDate: nextFutureMonday(2),
          isActive: true,
          highlight: false,
          seriesId: series.id,
          isPrivate: false,
        })
        .returning();
      if (!instance) throw new Error("Failed to create test instance");

      const client = createTestClient();
      const updateStatus = (isActive: boolean) =>
        client.event.crupdate({
          id: series.id,
          name: series.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: series.startDate,
          endDate: null,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive,
          eventTypeIds: [eventType.id],
          email: null,
        });

      await updateStatus(false);
      const [deactivatedInstance] = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, instance.id));
      expect(deactivatedInstance).toEqual({ id: instance.id, isActive: false });

      await updateStatus(true);
      const instances = await db
        .select({
          id: schema.eventInstances.id,
          isActive: schema.eventInstances.isActive,
        })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, series.id));
      expect(instances).toEqual([{ id: instance.id, isActive: true }]);
    });

    it("rejects an update when the event organization changes before its row lock", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const sourceAo = await createTestAO(region.id);
      const concurrentAo = await createTestAO(region.id);
      const destinationAo = await createTestAO(region.id);
      if (!sourceAo || !concurrentAo || !destinationAo) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      const adminSession = await createAdminSession();
      for (const ao of [sourceAo, concurrentAo, destinationAo]) {
        adminSession.roles?.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user?.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Concurrent org event ${uniqueId()}`,
          orgId: sourceAo.id,
          locationId: null,
          dayOfWeek: null,
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) throw new Error("Failed to create test event");
      createdEventIds.push(event.id);

      let signalLockHeld!: () => void;
      let releaseLock!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        signalLockHeld = resolve;
      });
      const waitToReleaseLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let blockerPid!: number;
      const lockTransaction = db.transaction(async (tx) => {
        await tx
          .update(schema.events)
          .set({ orgId: concurrentAo.id })
          .where(eq(schema.events.id, event.id));
        const [backend] = (await tx.execute(
          sql`SELECT pg_backend_pid() AS pid`,
        )) as unknown as { pid: number }[];
        if (!backend) throw new Error("Failed to identify lock backend");
        blockerPid = backend.pid;
        signalLockHeld();
        await waitToReleaseLock;
      });

      await lockHeld;
      const update = createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: destinationAo.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      let waitingBackendPid: number | undefined;
      let pollingError: unknown;
      try {
        for (let attempt = 0; attempt < 1000 && !waitingBackendPid; attempt++) {
          const activity = (await db.execute(sql`
            SELECT activity.pid, activity.wait_event_type
            FROM pg_stat_activity AS activity
            WHERE activity.wait_event_type = 'Lock'
              AND ${blockerPid} = ANY(pg_blocking_pids(activity.pid))
              AND activity.query ILIKE '%for update%'
          `)) as unknown as {
            pid: number;
            wait_event_type: string | null;
          }[];
          waitingBackendPid = activity.find(
            ({ wait_event_type }) => wait_event_type === "Lock",
          )?.pid;
          if (!waitingBackendPid) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      } catch (error) {
        pollingError = error;
      } finally {
        releaseLock();
        await Promise.allSettled([lockTransaction, update]);
      }

      expect(pollingError).toBeUndefined();
      expect(waitingBackendPid).toBeDefined();
      await expect(update).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Event was modified concurrently; reload and retry",
      });
      const [unchangedEvent] = await db
        .select({ orgId: schema.events.orgId })
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(unchangedEvent?.orgId).toBe(concurrentAo.id);
    }, 30000);

    it("creates instances when an inactive one-off becomes an active series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const eventType = await createTestEventType();
      if (!eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Inactive one-off conversion ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startTime: "0530",
          endTime: "0615",
          startDate: "2020-01-06",
          recurrencePattern: null,
          isActive: false,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);

      await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, event.id));
      expect(instances.length).toBeGreaterThan(0);
    });

    it("should create a new event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Give the session editor permission on the AO
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const eventName = `Test Event ${uniqueId()}`;

      const result = await client.event.crupdate({
        name: eventName,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "thursday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result).toHaveProperty("event");
      expect(result.event).not.toBeNull();
      expect(result.event?.name).toBe(eventName);

      if (result.event) {
        createdEventIds.push(result.event.id);
      }
    });

    it("should persist event tags and expose them in event reads", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tags = [await createTestEventTag(), await createTestEventTag()];
      const eventType = await createTestEventType();
      if (!tags[0] || !tags[1] || !eventType) return;
      const tagIds = [tags[0].id, tags[1].id];
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const client = createTestClient();
      const created = await client.event.crupdate({
        name: `Tagged Series ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [tagIds[0]!, tagIds[1]!, tagIds[0]!],
        email: null,
      });
      if (!created.event) return;
      createdEventIds.push(created.event.id);
      const detail = await client.event.byId({ id: created.event.id });
      expect(detail.event?.eventTagIds.sort()).toEqual(tagIds.sort());
      const list = await client.event.all({
        aoIds: [ao.id],
        pageIndex: 0,
        pageSize: 100,
      });
      expect(
        list.events
          .find((event) => event.id === created.event!.id)
          ?.eventTagIds.sort(),
      ).toEqual(tagIds.sort());
    });

    it("should clear series and future instance tags when explicitly cleared", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      const eventType = await createTestEventType();
      if (!tag || !eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const client = createTestClient();
      const startDate = nextFutureMonday(1);
      const endDate = nextFutureMonday(4);
      const created = await client.event.crupdate({
        name: `Clear Tagged Series ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate,
        endDate,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [tag.id],
        email: null,
      });
      if (!created.event) return;
      createdEventIds.push(created.event.id);

      const instancesBefore = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, created.event.id));
      expect(instancesBefore.length).toBeGreaterThan(0);

      await client.event.crupdate({
        id: created.event.id,
        name: created.event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate,
        endDate,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [],
        email: null,
      });

      const eventTags = await db
        .select()
        .from(schema.eventTagsXEvents)
        .where(eq(schema.eventTagsXEvents.eventId, created.event.id));
      const instanceTags = await db
        .select()
        .from(schema.eventTagsXEventInstances)
        .where(
          inArray(
            schema.eventTagsXEventInstances.eventInstanceId,
            instancesBefore.map((instance) => instance.id),
          ),
        );
      expect(eventTags).toEqual([]);
      expect(instanceTags).toEqual([]);
    });

    it("should preserve non-recurring event tags when omitted", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      const eventType = await createTestEventType();
      if (!tag || !eventType) return;
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Tagged Nonrecurring ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startDate: nextFutureMonday(1),
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);
      await db.insert(schema.eventTagsXEvents).values({
        eventId: event.id,
        eventTagId: tag.id,
      });
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      await createTestClient().event.crupdate({
        id: event.id,
        name: `${event.name} Updated`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      const tags = await db
        .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
        .from(schema.eventTagsXEvents)
        .where(eq(schema.eventTagsXEvents.eventId, event.id));
      expect(tags).toEqual([{ eventTagId: tag.id }]);
    });

    it.each([
      ["nonexistent", 999999999],
      ["inactive", "inactive"],
      ["cross-region", "cross-region"],
    ])(
      "should reject %s tags without partial event mutations",
      async (_label, tagCase) => {
        const region = await createTestRegion();
        if (!region) return;
        const ao = await createTestAO(region.id);
        if (!ao) return;
        const otherRegion = await createTestRegion();
        if (!otherRegion) return;
        const tag = await createTestEventTag();
        const parentRegionTag = await createScopedEventTag(region.id);
        const inactiveTag = await createScopedEventTag(ao.id, false);
        const crossRegionTag = await createScopedEventTag(otherRegion.id);
        const eventType = await createTestEventType();
        if (
          !tag ||
          !parentRegionTag ||
          !inactiveTag ||
          !crossRegionTag ||
          !eventType
        )
          return;
        const [event] = await db
          .insert(schema.events)
          .values({
            name: `Invalid Tag Event ${uniqueId()}`,
            orgId: ao.id,
            locationId: null,
            dayOfWeek: null,
            startDate: nextFutureMonday(1),
            isActive: true,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (!event) return;
        createdEventIds.push(event.id);
        await db.insert(schema.eventTagsXEvents).values({
          eventId: event.id,
          eventTagId: tag.id,
        });
        await mockAuthWithSession(
          createEditorSession({ orgId: ao.id, orgName: ao.name }),
        );

        const invalidTagId =
          typeof tagCase === "number"
            ? tagCase
            : tagCase === "inactive"
              ? inactiveTag.id
              : crossRegionTag.id;
        const error = await createTestClient()
          .event.crupdate({
            id: event.id,
            name: `${event.name} Mutated?`,
            aoId: ao.id,
            regionId: region.id,
            locationId: null,
            dayOfWeek: null,
            startTime: "0530",
            endTime: "0615",
            startDate: event.startDate,
            endDate: null,
            recurrencePattern: null,
            recurrenceInterval: null,
            indexWithinInterval: null,
            highlight: false,
            isActive: true,
            eventTypeIds: [eventType.id],
            eventTagIds: [invalidTagId],
            email: null,
          })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );
        expect(error).toMatchObject({ code: "BAD_REQUEST" });

        const [unchanged] = await db
          .select({ name: schema.events.name })
          .from(schema.events)
          .where(eq(schema.events.id, event.id));
        const associations = await db
          .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
          .from(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventId, event.id));
        expect(unchanged?.name).toBe(event.name);
        expect(associations).toEqual([{ eventTagId: tag.id }]);
      },
    );

    it("should accept nationwide and direct parent-region tags", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const nationwideTag = await createTestEventTag();
      const parentRegionTag = await createScopedEventTag(region.id);
      const eventType = await createTestEventType();
      if (!nationwideTag || !parentRegionTag || !eventType) return;

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const result = await createTestClient().event.crupdate({
        name: `Valid Scoped Tags ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: null,
        startTime: "0530",
        endTime: "0615",
        startDate: nextFutureMonday(1),
        endDate: null,
        recurrencePattern: null,
        recurrenceInterval: null,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        eventTagIds: [nationwideTag.id, parentRegionTag.id],
        email: null,
      });
      if (result.event) {
        createdEventIds.push(result.event.id);
        const tags = await db
          .select({ eventTagId: schema.eventTagsXEvents.eventTagId })
          .from(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventId, result.event.id));
        expect(tags.map(({ eventTagId }) => eventTagId).sort()).toEqual(
          [nationwideTag.id, parentRegionTag.id].sort(),
        );
      }
    });

    it("should carry existing event tags onto instances when starting a series", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const tag = await createTestEventTag();
      if (!tag) return;
      const eventType = await createTestEventType();
      if (!eventType) return;

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Converted Tagged Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: null,
          startDate: nextFutureMonday(1),
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);
      await db.insert(schema.eventTagsXEvents).values({
        eventId: event.id,
        eventTagId: tag.id,
      });

      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );
      const result = await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: "0615",
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result.event?.id).toBe(event.id);
      const instances = await db
        .select({ id: schema.eventInstances.id })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.seriesId, event.id));
      expect(instances.length).toBeGreaterThan(0);

      const tags = await db
        .select({ eventTagId: schema.eventTagsXEventInstances.eventTagId })
        .from(schema.eventTagsXEventInstances)
        .where(
          inArray(
            schema.eventTagsXEventInstances.eventInstanceId,
            instances.map((instance) => instance.id),
          ),
        );
      expect(tags).toHaveLength(instances.length);
      expect(tags.every(({ eventTagId }) => eventTagId === tag.id)).toBe(true);
    });

    it("should require all mandatory fields", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Missing required fields should fail validation
      await expect(
        client.event.crupdate({
          name: "Incomplete Event",
          locationId: 1,
          dayOfWeek: "friday",
          startTime: "0600",
          isActive: true,
        } as Parameters<typeof client.event.crupdate>[0]),
      ).rejects.toThrow();
    });

    it("should update an existing event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Create an event first
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Original Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "friday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Give the session editor permission on the AO
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const updatedName = `Updated Event ${uniqueId()}`;

      const result = await client.event.crupdate({
        id: testEvent.id,
        name: updatedName,
        aoId: ao.id,
        regionId: region.id,
        locationId: location.id,
        dayOfWeek: "saturday",
        startTime: "0700",
        endTime: "0800",
        startDate: "2026-01-01",
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      expect(result.event?.id).toBe(testEvent.id);
      expect(result.event?.name).toBe(updatedName);
    });

    it("notifies after an existing event moves across regions", async () => {
      await mockAuthWithSession(await createAdminSession());
      const regionA = await createTestRegion();
      const regionB = await createTestRegion();
      if (!regionA || !regionB) return;
      const aoA = await createTestAO(regionA.id);
      const aoB = await createTestAO(regionB.id);
      const eventType = await createTestEventType();
      if (!aoA || !aoB || !eventType) return;
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Move Event ${uniqueId()}`,
          orgId: aoA.id,
          dayOfWeek: "monday",
          startDate: nextFutureMonday(1),
          startTime: "0530",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);

      await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: aoB.id,
        regionId: regionB.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: null,
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      await waitForEventRegionNotificationTasks();
      expect(mockMaybeNotifyRegionInABox).toHaveBeenCalledWith(
        expect.anything(),
        regionB.id,
      );
    });

    it("notifies when an event moves from an AO with no parent region", async () => {
      const adminSession = await createAdminSession();
      const destinationRegion = await createTestRegion();
      if (!destinationRegion) return;
      const [sourceAo] = await db
        .insert(schema.orgs)
        .values({
          name: `Unparented AO ${uniqueId()}`,
          orgType: "ao",
          parentId: null,
          isActive: true,
        })
        .returning();
      if (!sourceAo) return;
      createdOrgIds.push(sourceAo.id);
      const destinationAo = await createTestAO(destinationRegion.id);
      const eventType = await createTestEventType();
      if (!destinationAo || !eventType) return;
      if (adminSession.roles && adminSession.user?.roles) {
        for (const ao of [sourceAo, destinationAo]) {
          const role = {
            orgId: ao.id,
            orgName: ao.name,
            roleName: "editor" as const,
          };
          adminSession.roles.push(role);
          adminSession.user.roles.push(role);
        }
      }
      await mockAuthWithSession(adminSession);
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Unparented AO Event ${uniqueId()}`,
          orgId: sourceAo.id,
          dayOfWeek: "monday",
          startDate: nextFutureMonday(1),
          startTime: "0530",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);

      await createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: destinationAo.id,
        regionId: destinationRegion.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: null,
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      await waitForEventRegionNotificationTasks();
      expect(mockMaybeNotifyRegionInABox).toHaveBeenCalledWith(
        expect.anything(),
        destinationRegion.id,
      );
    });

    it("does not notify for same-region moves or unrelated updates", async () => {
      await mockAuthWithSession(await createAdminSession());
      const region = await createTestRegion();
      if (!region) return;
      const aoA = await createTestAO(region.id);
      const aoB = await createTestAO(region.id);
      const eventType = await createTestEventType();
      if (!aoA || !aoB || !eventType) return;
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Same Region Move ${uniqueId()}`,
          orgId: aoA.id,
          dayOfWeek: "monday",
          startDate: nextFutureMonday(1),
          startTime: "0530",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);
      const client = createTestClient();
      const input = {
        id: event.id,
        name: event.name,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday" as const,
        startTime: "0530",
        endTime: null,
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly" as const,
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      };

      await client.event.crupdate({ ...input, aoId: aoB.id });
      await waitForEventRegionNotificationTasks();
      await client.event.crupdate({
        ...input,
        aoId: aoB.id,
        name: `${event.name} edited`,
      });
      await waitForEventRegionNotificationTasks();
      expect(mockMaybeNotifyRegionInABox).not.toHaveBeenCalled();
    });

    it("classifies the destination region after waiting for a destination AO move", async () => {
      await mockAuthWithSession(await createAdminSession());
      const sourceRegion = await createTestRegion();
      const initialDestinationRegion = await createTestRegion();
      if (!sourceRegion || !initialDestinationRegion) return;
      const sourceAo = await createTestAO(sourceRegion.id);
      const destinationAo = await createTestAO(initialDestinationRegion.id);
      const eventType = await createTestEventType();
      if (!sourceAo || !destinationAo || !eventType) return;
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Concurrent AO move ${uniqueId()}`,
          orgId: sourceAo.id,
          dayOfWeek: "monday",
          startDate: nextFutureMonday(1),
          startTime: "0530",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!event) return;
      createdEventIds.push(event.id);

      let signalLockHeld!: (pid: number) => void;
      let releaseLock!: () => void;
      const lockHeld = new Promise<number>((resolve) => {
        signalLockHeld = resolve;
      });
      const waitToReleaseLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const lockTransaction = db.transaction(async (tx) => {
        await tx
          .update(schema.orgs)
          .set({ parentId: sourceRegion.id })
          .where(eq(schema.orgs.id, destinationAo.id));
        const lockPidRow = (
          await tx.execute<{ pid: number }>(sql`
            SELECT pg_backend_pid() AS pid
          `)
        )[0];
        if (!lockPidRow) throw new Error("Failed to identify lock holder");
        signalLockHeld(lockPidRow.pid);
        await waitToReleaseLock;
      });

      const blockerPid = await lockHeld;
      const update = createTestClient().event.crupdate({
        id: event.id,
        name: event.name,
        aoId: destinationAo.id,
        regionId: sourceRegion.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: null,
        startDate: event.startDate,
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: true,
        eventTypeIds: [eventType.id],
        email: null,
      });

      let isWaitingForAoLock = false;
      try {
        for (let attempt = 0; attempt < 500 && !isWaitingForAoLock; attempt++) {
          const activity = (await db.execute(sql`
            SELECT wait_event_type, query
            FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%no key update%'
              AND pg_blocking_pids(pid) @> ARRAY[${blockerPid}]::int[]
          `)) as unknown as {
            wait_event_type: string | null;
            query: string;
          }[];
          isWaitingForAoLock = activity.some(
            ({ wait_event_type, query }) =>
              wait_event_type === "Lock" && /no key update/i.test(query),
          );
          if (!isWaitingForAoLock) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      } finally {
        releaseLock();
      }

      const [lockResult, updateResult] = await Promise.allSettled([
        lockTransaction,
        update,
      ]);
      await waitForEventRegionNotificationTasks();
      expect(lockResult.status).toBe("fulfilled");
      expect(isWaitingForAoLock).toBe(true);
      expect(updateResult.status).toBe("fulfilled");
      expect(mockMaybeNotifyRegionInABox).not.toHaveBeenCalled();
      const [updatedEvent] = await db
        .select({ orgId: schema.events.orgId })
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(updatedEvent?.orgId).toBe(destinationAo.id);
    });

    it("preserves creation notification for inactive recurring events", async () => {
      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      const eventType = await createTestEventType();
      if (!ao || !eventType) return;
      await mockAuthWithSession(
        createEditorSession({ orgId: ao.id, orgName: ao.name }),
      );

      const created = await createTestClient().event.crupdate({
        name: `Inactive Series ${uniqueId()}`,
        aoId: ao.id,
        regionId: region.id,
        locationId: null,
        dayOfWeek: "monday",
        startTime: "0530",
        endTime: null,
        startDate: nextFutureMonday(1),
        endDate: null,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: null,
        highlight: false,
        isActive: false,
        eventTypeIds: [eventType.id],
        email: null,
      });
      if (created.event) createdEventIds.push(created.event.id);
      await vi.waitFor(() =>
        expect(mockMaybeNotifyFirstEventForRegion).toHaveBeenCalledWith(
          expect.anything(),
          ao.id,
          region.id,
        ),
      );
    });

    it("should enforce editor permissions", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      const eventType = await createTestEventType();
      if (!eventType) return;

      // Create a session with no permission on this AO
      const noPermSession = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();

      await expect(
        client.event.crupdate({
          name: "Unauthorized Event",
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "sunday",
          startTime: "0800",
          endTime: "0900",
          startDate: "2026-01-01",
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        }),
      ).rejects.toThrow();
    });

    describe("destination org", () => {
      const setup = async () => {
        await mockAuthWithSession(await createAdminSession());
        const regionA = await createTestRegion();
        const regionB = await createTestRegion();
        if (!regionA || !regionB) throw new Error("Failed to create regions");
        const aoA = await createTestAO(regionA.id);
        const aoB = await createTestAO(regionB.id);
        const locationA = await createTestLocation(regionA.id);
        const locationB = await createTestLocation(regionB.id);
        const eventType = await createTestEventType();
        if (!aoA || !aoB || !locationA || !locationB || !eventType) {
          throw new Error("Failed to create fixtures");
        }
        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        const input = {
          name: `Scoped Event ${uniqueId()}`,
          aoId: aoA.id,
          regionId: regionA.id,
          locationId: locationA.id,
          dayOfWeek: "monday" as const,
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        };
        return {
          regionA,
          regionB,
          aoA,
          aoB,
          locationA,
          locationB,
          eventType,
          input,
        };
      };

      const editorOfBoth = (
        a: { id: number; name: string },
        b: { id: number; name: string },
      ) => {
        const session = createEditorSession({ orgId: a.id, orgName: a.name });
        return {
          ...session,
          roles: [
            ...session.roles!,
            { orgId: b.id, orgName: b.name, roleName: "editor" as const },
          ],
        };
      };

      const insertTypeSpecificTo = async (orgId: number) => {
        const [type] = await db
          .insert(schema.eventTypes)
          .values({
            name: `Scoped Type ${uniqueId()}`,
            eventCategory: "first_f",
            specificOrgId: orgId,
            isActive: true,
          })
          .returning();
        if (!type) throw new Error("Failed to create event type");
        createdEventTypeIds.push(type.id);
        return type;
      };

      const readEvent = async (id: number) => {
        const [stored] = await db
          .select()
          .from(schema.events)
          .where(eq(schema.events.id, id));
        return stored;
      };

      const findByName = async (name: string) =>
        db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.name, name));

      it("updates an event within its own AO", async () => {
        const { input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        const { event: updated } = await client.event.crupdate({
          ...input,
          id: event.id,
          name: `${input.name} renamed`,
        });

        expect(updated?.name).toBe(`${input.name} renamed`);
      });

      it("rejects creating an event in another region's AO", async () => {
        const { regionB, aoB, input } = await setup();

        await expect(
          createTestClient().event.crupdate({
            ...input,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect(await findByName(input.name)).toEqual([]);
      });

      it("rejects pulling another region's event into the caller's AO", async () => {
        const { regionA, regionB, aoA, aoB, input } = await setup();
        await mockAuthWithSession(
          createEditorSession({ orgId: regionB.id, orgName: regionB.name }),
        );
        const client = createTestClient();
        const { event } = await client.event.crupdate({
          ...input,
          aoId: aoB.id,
          regionId: regionB.id,
          locationId: null,
        });
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoA.id,
            regionId: regionA.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect((await readEvent(event.id))?.orgId).toBe(aoB.id);
      });

      it("rejects moving an event into another region's AO", async () => {
        const { regionB, aoA, aoB, input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

        const [stored] = await db
          .select({ orgId: schema.events.orgId })
          .from(schema.events)
          .where(eq(schema.events.id, event.id));
        expect(stored?.orgId).toBe(aoA.id);
      });

      it("rejects a location from another region", async () => {
        const { locationB, input } = await setup();

        await expect(
          createTestClient().event.crupdate({
            ...input,
            locationId: locationB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(await findByName(input.name)).toEqual([]);
      });

      it("rejects an event type specific to another region", async () => {
        const { regionB, input } = await setup();
        const [otherType] = await db
          .insert(schema.eventTypes)
          .values({
            name: `Other Region Type ${uniqueId()}`,
            eventCategory: "first_f",
            specificOrgId: regionB.id,
            isActive: true,
          })
          .returning();
        if (!otherType) throw new Error("Failed to create event type");
        createdEventTypeIds.push(otherType.id);

        await expect(
          createTestClient().event.crupdate({
            ...input,
            eventTypeIds: [otherType.id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(await findByName(input.name)).toEqual([]);
      });
      it("rejects adding another region's event type on update", async () => {
        const { regionB, eventType, input } = await setup();
        const otherType = await insertTypeSpecificTo(regionB.id);
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            eventTypeIds: [eventType.id, otherType.id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        const linked = await db
          .select({ id: schema.eventsXEventTypes.eventTypeId })
          .from(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, event.id));
        expect(linked.map(({ id }) => id)).toEqual([eventType.id]);
      });

      it("rejects switching to another region's location on update", async () => {
        const { locationA, locationB, input } = await setup();
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            locationId: locationB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readEvent(event.id))?.locationId).toBe(locationA.id);
      });

      it("re-checks existing links when moving an event", async () => {
        const { regionA, regionB, aoA, aoB, input } = await setup();
        await mockAuthWithSession(editorOfBoth(regionA, regionB));
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await expect(
          client.event.crupdate({
            ...input,
            id: event.id,
            aoId: aoB.id,
            regionId: regionB.id,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readEvent(event.id))?.orgId).toBe(aoA.id);
      });

      it("moves an event when the caller edits both regions", async () => {
        const { regionA, regionB, aoB, locationB, input } = await setup();
        await mockAuthWithSession(editorOfBoth(regionA, regionB));
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);

        await client.event.crupdate({
          ...input,
          id: event.id,
          aoId: aoB.id,
          regionId: regionB.id,
          locationId: locationB.id,
        });
        expect((await readEvent(event.id))?.orgId).toBe(aoB.id);
      });

      it("lets legacy out-of-region links through on unrelated edits", async () => {
        const { regionB, eventType, input } = await setup();
        const legacyType = await insertTypeSpecificTo(regionB.id);
        const client = createTestClient();
        const { event } = await client.event.crupdate(input);
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);
        await db
          .insert(schema.eventsXEventTypes)
          .values({ eventId: event.id, eventTypeId: legacyType.id });

        await client.event.crupdate({
          ...input,
          id: event.id,
          name: `${input.name} renamed`,
          eventTypeIds: [eventType.id, legacyType.id],
        });
        expect((await readEvent(event.id))?.name).toBe(`${input.name} renamed`);
      });

      it("accepts a location owned by another AO in the same region", async () => {
        const { regionA, aoA, input } = await setup();
        await mockAuthWithSession(await createAdminSession());
        const siblingAo = await createTestAO(regionA.id);
        if (!siblingAo) throw new Error("Failed to create AO");
        const siblingLocation = await createTestLocation(siblingAo.id);
        const aoLocation = await createTestLocation(aoA.id);
        if (!siblingLocation || !aoLocation) {
          throw new Error("Failed to create locations");
        }
        await mockAuthWithSession(
          createEditorSession({ orgId: regionA.id, orgName: regionA.name }),
        );
        const client = createTestClient();

        const { event } = await client.event.crupdate({
          ...input,
          locationId: siblingLocation.id,
        });
        if (!event) throw new Error("Failed to create event");
        createdEventIds.push(event.id);
        expect((await readEvent(event.id))?.locationId).toBe(
          siblingLocation.id,
        );

        const { event: moved } = await client.event.crupdate({
          ...input,
          id: event.id,
          aoId: siblingAo.id,
          locationId: aoLocation.id,
        });
        expect(moved?.id).toBe(event.id);
        expect((await readEvent(event.id))?.orgId).toBe(siblingAo.id);
      });
    });

    /**
     * `endDate` decides whether an event still counts as current in the map
     * queries and bounds the series instance cascade, so an inverted range must
     * be rejected server-side — the admin UI's client guard is bypassable.
     */
    describe("start/end date ordering", () => {
      /** Builds the org/location/event-type graph plus an editor session. */
      const setupCrupdateFixture = async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) throw new Error("Failed to create test region");

        const ao = await createTestAO(region.id);
        if (!ao) throw new Error("Failed to create test AO");

        const location = await createTestLocation(region.id);
        if (!location) throw new Error("Failed to create test location");

        const eventType = await createTestEventType();
        if (!eventType) throw new Error("Failed to create test event type");

        await mockAuthWithSession(
          createEditorSession({ orgId: ao.id, orgName: ao.name }),
        );

        return {
          client: createTestClient(),
          payload: {
            name: `Date Order Event ${uniqueId()}`,
            aoId: ao.id,
            regionId: region.id,
            locationId: location.id,
            dayOfWeek: "monday" as const,
            startTime: "0530",
            endTime: "0615",
            highlight: false,
            isActive: true,
            eventTypeIds: [eventType.id],
            email: null,
          },
        };
      };

      it("should reject an endDate before the startDate", async () => {
        const { client, payload } = await setupCrupdateFixture();

        await expect(
          client.event.crupdate({
            ...payload,
            startDate: "2026-02-01",
            endDate: "2026-01-31",
          }),
        ).rejects.toThrow();

        // Nothing may be persisted when the range is invalid.
        const persisted = await db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.name, payload.name));
        expect(persisted).toHaveLength(0);
      });

      it("should report the rejection against the endDate field", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const error = await client.event
          .crupdate({
            ...payload,
            startDate: "2026-02-01",
            endDate: "2026-01-01",
          })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );

        // Input validation failures surface as BAD_REQUEST, not a 500.
        expect(error).toMatchObject({ code: "BAD_REQUEST" });
        const issues =
          (
            error as {
              data?: { issues?: { path?: unknown[]; message?: string }[] };
            }
          ).data?.issues ?? [];
        // Pathed at endDate so the admin form can attach the message to that
        // field rather than showing a form-level error.
        expect(issues).toContainEqual(
          expect.objectContaining({
            path: ["endDate"],
            message: "End date must be on or after start date",
          }),
        );
      });

      it("should accept an endDate equal to the startDate (single-day event)", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-02-01",
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.startDate).toBe("2026-02-01");
        expect(result.event?.endDate).toBe("2026-02-01");
      });

      it("should accept an endDate after the startDate", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-03-01",
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.endDate).toBe("2026-03-01");
      });

      it("should accept a null endDate (open-ended series)", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const result = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: null,
        });

        if (result.event) createdEventIds.push(result.event.id);
        expect(result.event?.endDate).toBeNull();
      });

      it("should reject an inverted range when updating an existing event", async () => {
        const { client, payload } = await setupCrupdateFixture();

        const created = await client.event.crupdate({
          ...payload,
          startDate: "2026-02-01",
          endDate: "2026-03-01",
        });
        const eventId = created.event?.id;
        if (!eventId) throw new Error("Failed to create event");
        createdEventIds.push(eventId);

        await expect(
          client.event.crupdate({
            ...payload,
            id: eventId,
            startDate: "2026-02-01",
            endDate: "2026-01-01",
          }),
        ).rejects.toThrow();

        // The stored row must keep its valid range.
        const [unchanged] = await db
          .select({ endDate: schema.events.endDate })
          .from(schema.events)
          .where(eq(schema.events.id, eventId));
        expect(unchanged?.endDate).toBe("2026-03-01");
      });
    });
  });

  describe("delete", () => {
    it("should soft delete an event (mark as inactive)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event to delete
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Delete Test Event ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Give the session admin permission on the AO
      const adminSession = await createAdminSession();
      if (adminSession.roles && adminSession.user?.roles) {
        adminSession.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
        adminSession.user.roles.push({
          orgId: ao.id,
          orgName: ao.name,
          roleName: "admin",
        });
      }
      await mockAuthWithSession(adminSession);

      const client = createTestClient();

      const result = await client.event.delete({
        id: testEvent.id,
      });

      expect(result.eventId).toBe(testEvent.id);

      // Verify it's marked as inactive
      const [deletedEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, testEvent.id));

      expect(deletedEvent?.isActive).toBe(false);
    });

    it("should require admin permission to delete", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const region = await createTestRegion();
      if (!region) return;

      const ao = await createTestAO(region.id);
      if (!ao) return;

      const location = await createTestLocation(region.id);
      if (!location) return;

      // Create an event
      const [testEvent] = await db
        .insert(schema.events)
        .values({
          name: `Delete Auth Test ${uniqueId()}`,
          orgId: ao.id,
          locationId: location.id,
          dayOfWeek: "tuesday",
          startTime: "0600",
          isActive: true,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();

      if (!testEvent) return;
      createdEventIds.push(testEvent.id);

      // Create a session with only editor permission (not admin)
      const editorSession = createEditorSession({
        orgId: ao.id,
        orgName: ao.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();

      await expect(
        client.event.delete({
          id: testEvent.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("eventIdToRegionNameLookup", () => {
    it("should return a lookup map of event IDs to region names", async () => {
      const client = createTestClient();
      const result = await client.event.eventIdToRegionNameLookup();

      expect(result).toHaveProperty("lookup");
      expect(typeof result.lookup).toBe("object");
    });

    it("should hide an active, non-private event at an inactive location from an anonymous caller, but not from a signed-in caller", async () => {
      // The test harness defaults to a signed-in admin session; a prior
      // test case may have left the auth mock on a specific session too,
      // so explicitly reset to anonymous before the "anonymous" assertions.
      await mockAuthWithSession(null);

      const region = await createTestRegion();
      if (!region) return;
      const ao = await createTestAO(region.id);
      if (!ao) return;
      const location = await createTestLocation(ao.id);
      if (!location) return;

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Deleted Location Lookup Event ${uniqueId()}`,
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
      if (!event) return;
      createdEventIds.push(event.id);

      // location.delete only soft-deletes the location (isActive: false)
      await db
        .update(schema.locations)
        .set({ isActive: false })
        .where(eq(schema.locations.id, location.id));

      const anonymousClient = createTestClient();
      const anonymousResult =
        await anonymousClient.event.eventIdToRegionNameLookup();
      expect(anonymousResult.lookup).not.toHaveProperty(String(event.id));

      const session = await createAdminSession();
      await mockAuthWithSession(session);
      const signedInClient = createTestClient();
      const signedInResult =
        await signedInClient.event.eventIdToRegionNameLookup();
      expect(signedInResult.lookup).toHaveProperty(String(event.id));
    });
  });
  describe("cascade service integration", () => {
    describe("crupdate with recurrence", () => {
      it("should create event instances when creating a new recurring series", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();
        const seriesName = `Recurring Series ${uniqueId()}`;

        const result = await client.event.crupdate({
          name: seriesName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event).not.toBeNull();
        expect(result.event?.recurrencePattern).toBe("weekly");

        const seriesId = result.event?.id;
        if (seriesId) {
          createdEventIds.push(seriesId);

          // Verify instances were created
          const instances = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.seriesId, seriesId));

          expect(instances.length).toBeGreaterThan(0);
          // Should have instances for each Monday from Jan 1 to March 31, 2026
          expect(instances.length).toBeGreaterThanOrEqual(12);
          // Instances in eventInstances are cascade-deleted with the parent series event
        }
      });

      it("should update future instances in place for non-structural changes", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        // Create initial series
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Original Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2026-01-01",
            endDate: "2026-03-31",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);
        // Create some instances
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Original Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();
        const updatedName = `Updated Series ${uniqueId()}`;

        // Non-structural change: update name and time (not dayOfWeek, recurrence pattern, etc.)
        const result = await client.event.crupdate({
          id: seriesEvent.id,
          name: updatedName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "monday", // Same
          startTime: "0600", // Changed (non-structural)
          endTime: "0645", // Changed (non-structural)
          startDate: "2026-01-01", // Same
          endDate: "2026-03-31", // Same
          recurrencePattern: "weekly", // Same
          recurrenceInterval: 1, // Same
          indexWithinInterval: null, // Same
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event?.name).toBe(updatedName);
        expect(result.event?.startTime).toBe("0600");

        // Verify instance was updated in place (not recreated with new ID)
        if (instance1) {
          const [updatedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(updatedInstance?.name).toBe(updatedName);
          expect(updatedInstance?.startTime).toBe("0600");
          expect(updatedInstance?.seriesId).toBe(seriesEvent.id);
        }
      });

      it("should recreate future instances for structural changes", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const eventTag = await createTestEventTag();
        if (!eventTag) return;

        // Use dynamic dates so the series is always active relative to today
        const seriesStartDate = nextFutureMonday(1);
        const seriesEndDate = nextFutureMonday(12);

        // Create initial series on Mondays
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Structural Change Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: seriesStartDate,
            endDate: seriesEndDate,
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);
        await db.insert(schema.eventTagsXEvents).values({
          eventId: seriesEvent.id,
          eventTagId: eventTag.id,
        });

        // Create initial instance on Monday
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Structural Change Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Structural change: change dayOfWeek from Monday to Tuesday
        const result = await client.event.crupdate({
          id: seriesEvent.id,
          name: seriesEvent.name,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "tuesday", // Changed from Monday (structural)
          startTime: "0530",
          endTime: "0615",
          startDate: seriesStartDate,
          endDate: seriesEndDate,
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event?.dayOfWeek).toBe("tuesday");

        // Verify old instance was hard-deleted (recreateFutureInstances deletes and recreates)
        if (instance1) {
          const [deletedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(deletedInstance).toBeUndefined();
        }

        // Verify new instances were created for Tuesdays
        const newInstances = await db
          .select()
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesEvent.id));

        expect(newInstances.length).toBeGreaterThan(0);
        const recreatedInstanceIds = newInstances.map(
          (instance) => instance.id,
        );
        const recreatedTags = await db
          .select()
          .from(schema.eventTagsXEventInstances)
          .where(
            inArray(
              schema.eventTagsXEventInstances.eventInstanceId,
              recreatedInstanceIds,
            ),
          );
        expect(
          recreatedTags.every((tag) => tag.eventTagId === eventTag.id),
        ).toBe(true);
        expect(recreatedTags).toHaveLength(recreatedInstanceIds.length);
        for (const instanceId of recreatedInstanceIds) {
          expect(
            recreatedTags.filter((tag) => tag.eventInstanceId === instanceId),
          ).toHaveLength(1);
        }
      });

      it("should create weekly instances when recurrencePattern is null (defaults to weekly)", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Create event with null recurrencePattern — should default to weekly
        const result = await client.event.crupdate({
          name: `Null Recurrence Weekly ${uniqueId()}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "wednesday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(result.event).not.toBeNull();
        expect(result.event?.recurrencePattern).toBeNull();

        if (result.event) {
          createdEventIds.push(result.event.id);

          // Should still have weekly instances generated
          const instances = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.seriesId, result.event.id));

          expect(instances.length).toBeGreaterThan(0);
          // ~12 Wednesdays from Jan 1 to March 31
          expect(instances.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("should update instances in place (not duplicate) when updating a series with null recurrencePattern", async () => {
        // Regression test: a series with dayOfWeek set but recurrencePattern = null was
        // incorrectly treated as a non-series event on update, causing createEventInstancesForSeries
        // to run again and duplicate all existing instances.
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        const eventType = await createTestEventType();
        if (!eventType) return;

        const editorSession = createEditorSession({
          orgId: ao.id,
          orgName: ao.name,
        });
        await mockAuthWithSession(editorSession);

        const client = createTestClient();

        // Step 1: Create a series with dayOfWeek set and recurrencePattern: null (defaults to weekly)
        const createResult = await client.event.crupdate({
          name: `Null Recurrence Regression ${uniqueId()}`,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "thursday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2027-01-01",
          endDate: "2027-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(createResult.event).not.toBeNull();
        const seriesId = createResult.event!.id;
        createdEventIds.push(seriesId);

        // Step 2: Record the unique instance dates after creation
        const instancesAfterCreate = await db
          .select({
            id: schema.eventInstances.id,
            startDate: schema.eventInstances.startDate,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesId));

        expect(instancesAfterCreate.length).toBeGreaterThan(0);
        const datesAfterCreate = instancesAfterCreate
          .map((i) => i.startDate)
          .sort();

        // Step 3: Update a non-structural field (name) — recurrencePattern stays null
        const updatedName = `Null Recurrence Regression Updated ${uniqueId()}`;
        const updateResult = await client.event.crupdate({
          id: seriesId,
          name: updatedName,
          aoId: ao.id,
          regionId: region.id,
          locationId: location.id,
          dayOfWeek: "thursday",
          startTime: "0530",
          endTime: "0615",
          startDate: "2027-01-01",
          endDate: "2027-03-31",
          recurrencePattern: null,
          recurrenceInterval: null,
          indexWithinInterval: null,
          highlight: false,
          isActive: true,
          eventTypeIds: [eventType.id],
          email: null,
        });

        expect(updateResult.event?.name).toBe(updatedName);

        // Step 4: Assert no duplicate instances were created
        const instancesAfterUpdate = await db
          .select({
            id: schema.eventInstances.id,
            startDate: schema.eventInstances.startDate,
            name: schema.eventInstances.name,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.seriesId, seriesId));

        const datesAfterUpdate = instancesAfterUpdate
          .map((i) => i.startDate)
          .sort();

        // Instance count must not increase
        expect(instancesAfterUpdate.length).toBe(instancesAfterCreate.length);

        // Dates must be identical (no duplicates, no new entries)
        expect(datesAfterUpdate).toEqual(datesAfterCreate);

        // Instances should reflect the updated name
        expect(instancesAfterUpdate.every((i) => i.name === updatedName)).toBe(
          true,
        );
      });

      it("should cascade soft-delete to instances when deleting a series", async () => {
        const session = await createAdminSession();
        await mockAuthWithSession(session);

        const region = await createTestRegion();
        if (!region) return;

        const ao = await createTestAO(region.id);
        if (!ao) return;

        const location = await createTestLocation(region.id);
        if (!location) return;

        // Create initial recurring series
        const [seriesEvent] = await db
          .insert(schema.events)
          .values({
            name: `Delete Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            dayOfWeek: "monday",
            startTime: "0530",
            endTime: "0615",
            startDate: "2026-01-01",
            endDate: "2026-03-31",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
            indexWithinInterval: null,
            isActive: true,
            highlight: false,
          })
          .returning();

        if (!seriesEvent) return;
        createdEventIds.push(seriesEvent.id);

        // Create instances
        const [instance1] = await db
          .insert(schema.eventInstances)
          .values({
            name: `Delete Series ${uniqueId()}`,
            orgId: ao.id,
            locationId: location.id,
            startTime: "0530",
            endTime: "0615",
            startDate: nextFutureMonday(2),
            isActive: true,
            highlight: false,
            seriesId: seriesEvent.id,
            isPrivate: false,
          })
          .returning();

        const adminSession = await createAdminSession();
        if (adminSession.roles && adminSession.user?.roles) {
          adminSession.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
          adminSession.user.roles.push({
            orgId: ao.id,
            orgName: ao.name,
            roleName: "admin",
          });
        }
        await mockAuthWithSession(adminSession);

        const client = createTestClient();

        const result = await client.event.delete({
          id: seriesEvent.id,
        });

        expect(result.eventId).toBe(seriesEvent.id);

        // Verify series is soft-deleted
        const [deletedSeries] = await db
          .select()
          .from(schema.events)
          .where(eq(schema.events.id, seriesEvent.id));

        expect(deletedSeries?.isActive).toBe(false);

        // Verify instances are soft-deleted
        if (instance1) {
          const [deletedInstance] = await db
            .select()
            .from(schema.eventInstances)
            .where(eq(schema.eventInstances.id, instance1.id));

          expect(deletedInstance?.isActive).toBe(false);
        }
      });
    });
  });
});
