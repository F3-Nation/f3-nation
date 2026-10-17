import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { schema } from "@acme/db";
import { ORG_TREE_MAX_DEPTH } from "@acme/shared/app/org-hierarchy";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createNoPermissionSession,
  createOrgTree,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("public reads exclude inactive organization hierarchies", () => {
  const prefix = `PUBLIC_ORG_ACTIVITY_${uniqueId()}`;
  const crossRegionName = `PUBLIC_CROSS_REGION_${uniqueId()}`;
  const aoOwnedLocationName = `PUBLIC_AO_OWNED_LOCATION_${uniqueId()}`;
  const primaryLabels = [
    "activeA",
    "activeB",
    "inactiveAO",
    "inactiveRegion",
    "inactiveArea",
  ] as const;
  const orgIds: number[] = [];
  const locationIds: number[] = [];
  const eventIds: number[] = [];
  const typeIds: number[] = [];
  const branches: Record<
    string,
    {
      regionId: number;
      aoId: number;
      locationId: number;
      eventId: number;
      typeId: number;
    }
  > = {};
  let nationalTypeId: number;
  let aoOwnedLocationId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({ success: true });
    await mockAuthWithSession(null);
  });

  beforeAll(async () => {
    const nation = await getOrCreateF3NationOrg();
    const [nationalType] = await db
      .insert(schema.eventTypes)
      .values({
        name: `${prefix}_national`,
        eventCategory: "first_f",
        specificOrgId: null,
        isActive: true,
      })
      .returning();
    nationalTypeId = nationalType!.id;
    typeIds.push(nationalTypeId);

    for (const label of primaryLabels) {
      const [area] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix}_${label}_area`,
          parentId: nation.id,
          orgType: "area",
          isActive: label !== "inactiveArea",
        })
        .returning();
      orgIds.push(area!.id);
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix}_${label}_region`,
          parentId: area!.id,
          orgType: "region",
          isActive: label !== "inactiveRegion",
        })
        .returning();
      orgIds.push(region!.id);
      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix}_${label}_ao`,
          parentId: region!.id,
          orgType: "ao",
          isActive: label !== "inactiveAO",
          email: "public-org-fixture@example.com",
          meta: { fixture: true },
        })
        .returning();
      orgIds.push(ao!.id);
      const [location] = await db
        .insert(schema.locations)
        .values({
          name: `${prefix}_${label}_location`,
          orgId: region!.id,
          isActive: true,
          latitude: 35.5,
          longitude: -80.5,
          email: "public-org-fixture@example.com",
          meta: { fixture: true },
        })
        .returning();
      locationIds.push(location!.id);
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `${prefix}_${label}_event`,
          orgId: ao!.id,
          locationId: location!.id,
          isActive: true,
          isPrivate: false,
          highlight: false,
          startDate: "2026-01-01",
          dayOfWeek: "monday",
          startTime: "0530",
          endTime: "0630",
          email: "public-org-fixture@example.com",
          meta: { fixture: true },
        })
        .returning();
      eventIds.push(event!.id);
      const [type] = await db
        .insert(schema.eventTypes)
        .values({
          name: `${prefix}_${label}_type`,
          specificOrgId: ao!.id,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();
      typeIds.push(type!.id);
      await db.insert(schema.eventsXEventTypes).values([
        { eventId: event!.id, eventTypeId: nationalTypeId },
        { eventId: event!.id, eventTypeId: type!.id },
      ]);
      branches[label] = {
        regionId: region!.id,
        aoId: ao!.id,
        locationId: location!.id,
        eventId: event!.id,
        typeId: type!.id,
      };
    }

    // The event's own organization is active; its location belongs to a retired Region.
    const [crossRegionEvent] = await db
      .insert(schema.events)
      .values({
        name: crossRegionName,
        orgId: branches.activeA!.aoId,
        locationId: branches.inactiveRegion!.locationId,
        isActive: true,
        isPrivate: false,
        highlight: false,
        startDate: "2026-01-01",
      })
      .returning();
    eventIds.push(crossRegionEvent!.id);
    branches.retiredLocationOwner = {
      ...branches.activeA!,
      locationId: branches.inactiveRegion!.locationId,
      eventId: crossRegionEvent!.id,
    };

    const [aoOwnedLocation] = await db
      .insert(schema.locations)
      .values({
        name: aoOwnedLocationName,
        orgId: branches.inactiveAO!.aoId,
        isActive: true,
        latitude: 35.5,
        longitude: -80.5,
      })
      .returning();
    aoOwnedLocationId = aoOwnedLocation!.id;
    locationIds.push(aoOwnedLocationId);
    const [aoLocationEvent] = await db
      .insert(schema.events)
      .values({
        name: `PUBLIC_AO_OWNED_EVENT_${uniqueId()}`,
        orgId: branches.activeA!.aoId,
        locationId: aoOwnedLocationId,
        isActive: true,
        isPrivate: false,
        highlight: false,
        startDate: "2026-01-01",
      })
      .returning();
    eventIds.push(aoLocationEvent!.id);
  });

  afterAll(async () => {
    for (const id of [...eventIds].reverse()) await cleanup.event(id);
    for (const id of [...typeIds].reverse()) await cleanup.eventType(id);
    for (const id of [...locationIds].reverse()) await cleanup.location(id);
    for (const id of [...orgIds].reverse()) await cleanup.org(id);
  });

  it("filters organization results and totals before pagination, retaining public redaction", async () => {
    const client = createTestClient();
    const pages = [];
    for (const pageIndex of [0, 1, 2]) {
      pages.push(
        await client.org.all({
          orgTypes: ["ao"],
          searchTerm: prefix,
          statuses: ["active", "inactive"],
          sorting: [{ id: "name", desc: false }],
          pageSize: 1,
          pageIndex,
        }),
      );
    }
    expect(pages.map((page) => page.total)).toEqual([2, 2, 2]);
    expect(pages.flatMap((page) => page.orgs.map((org) => org.id))).toEqual([
      branches.activeA!.aoId,
      branches.activeB!.aoId,
    ]);
    expect(pages[0]!.orgs[0]).toMatchObject({ email: null, meta: null });
  });

  it.each(["inactiveAO", "inactiveRegion", "inactiveArea"])(
    "hides guessed organization IDs for %s",
    async (label) => {
      expect(
        await createTestClient().org.byId({ id: branches[label]!.aoId }),
      ).toEqual({ org: null });
    },
  );

  it("hides Regions under retired ancestors while retaining Regions with retired child AOs", async () => {
    const client = createTestClient();
    const result = await client.org.all({
      orgTypes: ["region"],
      searchTerm: prefix,
      statuses: ["active", "inactive"],
      sorting: [{ id: "name", desc: false }],
      pageSize: 100,
    });
    expect(result.total).toBe(3);
    expect(result.orgs.map((org) => org.id)).toEqual([
      branches.activeA!.regionId,
      branches.activeB!.regionId,
      branches.inactiveAO!.regionId,
    ]);
    expect(
      await client.org.byId({ id: branches.inactiveArea!.regionId }),
    ).toEqual({ org: null });
  });

  it("checks inactive ancestors through the supported depth boundary", async () => {
    const tree = createOrgTree();
    try {
      const retiredRoot = await tree.create({
        orgType: "sector",
        isActive: false,
      });
      const descendants = await tree.chain(
        Array.from({ length: ORG_TREE_MAX_DEPTH + 1 }, () => "sector" as const),
        { parentId: retiredRoot.id },
      );
      const boundary = descendants[ORG_TREE_MAX_DEPTH - 1]!;
      const beyondBoundary = descendants[ORG_TREE_MAX_DEPTH]!;
      const client = createTestClient();
      expect(await client.org.byId({ id: boundary.id })).toEqual({ org: null });
      // Preserve the existing bounded traversal: a more distant inactive ancestor is not inspected.
      expect((await client.org.byId({ id: beyondBoundary.id })).org?.id).toBe(
        beyondBoundary.id,
      );
      await mockAuthWithSession(createNoPermissionSession());
      expect((await client.org.byId({ id: boundary.id })).org?.id).toBe(
        boundary.id,
      );
    } finally {
      await tree.cleanup();
    }
  });

  it("terminates and hides an active organization in a cycle with an inactive parent", async () => {
    const tree = createOrgTree();
    let cycleRootId: number | undefined;
    try {
      const retired = await tree.create({ orgType: "sector", isActive: false });
      cycleRootId = retired.id;
      const active = await tree.create({
        orgType: "area",
        parentId: retired.id,
      });
      await tree.move(retired.id, active.id);
      const client = createTestClient();
      expect(await client.org.byId({ id: active.id })).toEqual({ org: null });
      expect(await client.org.byId({ id: retired.id })).toEqual({ org: null });
      await mockAuthWithSession(createNoPermissionSession());
      expect((await client.org.byId({ id: active.id })).org?.id).toBe(
        active.id,
      );
    } finally {
      if (cycleRootId !== undefined) await tree.move(cycleRootId, null);
      await tree.cleanup();
    }
  });

  it("filters event results and totals before pagination, retaining public redaction", async () => {
    const client = createTestClient();
    const pages = [];
    for (const pageIndex of [0, 1, 2]) {
      pages.push(
        await client.event.all({
          searchTerm: prefix,
          statuses: ["active", "inactive"],
          sorting: [{ id: "name", desc: false }],
          pageSize: 1,
          pageIndex,
        }),
      );
    }
    expect(pages.map((page) => page.totalCount)).toEqual([2, 2, 2]);
    expect(
      pages.flatMap((page) => page.events.map((event) => event.id)),
    ).toEqual([branches.activeA!.eventId, branches.activeB!.eventId]);
    expect(pages[0]!.events[0]).toMatchObject({ email: null });
  });

  it.each(["inactiveAO", "inactiveRegion", "inactiveArea"])(
    "hides guessed event IDs for %s",
    async (label) => {
      expect(
        await createTestClient().event.byId({ id: branches[label]!.eventId }),
      ).toEqual({ event: null });
    },
  );

  it("keeps active details and masks sensitive fields", async () => {
    const client = createTestClient();
    expect(
      (await client.org.byId({ id: branches.activeA!.aoId })).org,
    ).toMatchObject({ id: branches.activeA!.aoId, email: null, meta: null });
    expect(
      (await client.event.byId({ id: branches.activeA!.eventId })).event,
    ).toMatchObject({ id: branches.activeA!.eventId, email: null, meta: null });
    // Match the Map: check the event's org chain even at a retired Region's location.
    expect(
      (await client.event.byId({ id: branches.retiredLocationOwner!.eventId }))
        .event?.id,
    ).toBe(branches.retiredLocationOwner!.eventId);
    expect(
      (await client.event.all({ searchTerm: crossRegionName })).events.map(
        (event) => event.id,
      ),
    ).toContain(branches.retiredLocationOwner!.eventId);
  });

  it("omits retired branches from the event-to-Region lookup", async () => {
    const { lookup } =
      await createTestClient().event.eventIdToRegionNameLookup();
    for (const label of ["activeA", "activeB", "retiredLocationOwner"])
      expect(lookup[branches[label]!.eventId]).toBeDefined();
    for (const label of ["inactiveAO", "inactiveRegion", "inactiveArea"])
      expect(lookup[branches[label]!.eventId]).toBeUndefined();
  });

  it("requires both the location owner and an eligible workout owner to be active", async () => {
    const client = createTestClient();
    const pages = [];
    for (const pageIndex of [0, 1, 2]) {
      pages.push(
        await client.location.all({
          searchTerm: prefix,
          statuses: ["active", "inactive"],
          sorting: [{ id: "locationName", desc: false }],
          pageSize: 1,
          pageIndex,
        }),
      );
    }
    expect(pages.map((page) => page.totalCount)).toEqual([2, 2, 2]);
    expect(
      pages.flatMap((page) => page.locations.map((location) => location.id)),
    ).toEqual([branches.activeA!.locationId, branches.activeB!.locationId]);
    expect(pages[0]!.locations[0]).toMatchObject({ email: null, meta: null });
  });

  it("hides a retired AO's location despite a workout owned by an active AO", async () => {
    const client = createTestClient();
    expect(
      await client.location.all({ searchTerm: aoOwnedLocationName }),
    ).toEqual({
      locations: [],
      totalCount: 0,
    });
    await mockAuthWithSession(createNoPermissionSession());
    const result = await client.location.all({
      searchTerm: aoOwnedLocationName,
    });
    expect(result.totalCount).toBe(1);
    expect(result.locations.map((location) => location.id)).toEqual([
      aoOwnedLocationId,
    ]);
  });

  it("filters scoped event types before pagination and retains national types", async () => {
    const client = createTestClient();
    const pages = [];
    for (const pageIndex of [0, 1, 2, 3]) {
      pages.push(
        await client.eventType.all({
          searchTerm: prefix,
          statuses: ["active", "inactive"],
          sorting: [{ id: "name", desc: false }],
          pageSize: 1,
          pageIndex,
        }),
      );
    }
    expect(pages.map((page) => page.totalCount)).toEqual([3, 3, 3, 3]);
    expect(
      pages.flatMap((page) => page.eventTypes.map((type) => type.id)),
    ).toEqual([
      branches.activeA!.typeId,
      branches.activeB!.typeId,
      nationalTypeId,
    ]);
    expect(
      (
        await client.eventType.all({ searchTerm: prefix, nationalOnly: true })
      ).eventTypes.map((type) => type.id),
    ).toEqual([nationalTypeId]);
    // Usage counts retain their existing meaning, including retired organizations' events.
    expect(
      pages
        .flatMap((page) => page.eventTypes)
        .find((type) => type.id === nationalTypeId)?.count,
    ).toBe(5);
  });

  it("preserves ordinary signed-in access to retired branches and sensitive fields", async () => {
    await mockAuthWithSession(createNoPermissionSession());
    const client = createTestClient();
    const orgs = await client.org.all({
      orgTypes: ["ao"],
      searchTerm: prefix,
      statuses: ["active", "inactive"],
      pageSize: 100,
    });
    expect(orgs.total).toBe(primaryLabels.length);
    expect(orgs.orgs.map((org) => org.id).sort((a, b) => a - b)).toEqual(
      primaryLabels.map((label) => branches[label]!.aoId).sort((a, b) => a - b),
    );
    const events = await client.event.all({
      searchTerm: prefix,
      statuses: ["active", "inactive"],
      pageSize: 100,
    });
    expect(events.totalCount).toBe(primaryLabels.length);
    expect(
      events.events.map((event) => event.id).sort((a, b) => a - b),
    ).toEqual(
      primaryLabels
        .map((label) => branches[label]!.eventId)
        .sort((a, b) => a - b),
    );
    expect(
      (await client.location.all({ searchTerm: prefix, pageSize: 100 }))
        .totalCount,
    ).toBe(5);
    expect(
      (await client.eventType.all({ searchTerm: prefix, pageSize: 100 }))
        .totalCount,
    ).toBe(6);
    const { lookup } = await client.event.eventIdToRegionNameLookup();
    for (const label of [...primaryLabels, "retiredLocationOwner"]) {
      const branch = branches[label]!;
      expect((await client.org.byId({ id: branch.aoId })).org).toMatchObject({
        id: branch.aoId,
        email: "public-org-fixture@example.com",
        meta: { fixture: true },
      });
      expect((await client.event.byId({ id: branch.eventId })).event?.id).toBe(
        branch.eventId,
      );
      expect(lookup[branch.eventId]).toBeDefined();
    }
  });
});
