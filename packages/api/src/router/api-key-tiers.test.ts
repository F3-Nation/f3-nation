/**
 * What each kind of caller reaches: no credential, a role-less API key, a
 * signed-in member, and API keys holding a role. A role-less key authorizes
 * nothing, so it must get exactly what an anonymous caller gets. A key holding
 * a role acts only through that role, never as the user who owns it.
 *
 * These tests require TEST_DATABASE_URL to point at the seeded test database.
 */
import { randomUUID } from "node:crypto";
import type { Session } from "@acme/auth";
import { createRouterClient } from "@orpc/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { eq, inArray, schema } from "@acme/db";

import {
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
} from "../__tests__/test-utils";
import { router } from "../index";
import { API_KEY_SESSION_USER_ID, protectedProcedure } from "../shared";

const clientFor = (token?: string) =>
  createRouterClient(
    {
      ...router,
      identity: protectedProcedure.handler(({ context }) => ({
        id: context.session!.id,
        email: context.session!.email ?? null,
        userEmail: context.session!.user?.email ?? null,
      })),
    },
    {
      context: () => ({
        reqHeaders: new Headers({
          client: "api-key-tiers-test",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        }),
      }),
    },
  );
type Client = ReturnType<typeof clientFor>;

const KEY_REQUEST_MESSAGE =
  "API keys cannot submit or review change requests; sign in with a user account";

describe("API-key access tiers", () => {
  const orgIds: number[] = [];
  const keyIds: number[] = [];
  let ownerId: number;
  let ownerEmail: string;
  let regionA: { id: number; name: string };
  let retiredRegionId: number;
  let insertedUserRoleId: number | undefined;
  const keys = {
    readOnly: randomUUID(),
    userOnly: randomUUID(),
    editorOnA: randomUUID(),
    editorOnB: randomUUID(),
    unknown: randomUUID(),
  };

  const memberSession = (): Session => ({
    id: ownerId,
    email: "member@example.test",
    user: { id: String(ownerId), email: "member@example.test", roles: [] },
    roles: [],
    expires: new Date(Date.now() + 3600000).toISOString(),
  });

  beforeAll(async () => {
    await getOrCreateRoles();
    const nation = await getOrCreateF3NationOrg();
    const insertRegion = async (isActive: boolean) => {
      const [org] = await db
        .insert(schema.orgs)
        .values({
          name: `Tier Region ${randomUUID()}`,
          orgType: "region",
          parentId: nation.id,
          isActive,
          email: "region-contact@example.test",
          phone: "555-0100",
        })
        .returning();
      orgIds.push(org!.id);
      return org!;
    };
    regionA = await insertRegion(true);
    const regionB = await insertRegion(true);
    retiredRegionId = (await insertRegion(false)).id;

    const [owner] = await db
      .insert(schema.users)
      .values({ email: `${randomUUID()}@example.test`, f3Name: "KeyOwner" })
      .returning();
    ownerId = owner!.id;
    ownerEmail = owner!.email;

    const [editorRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, "editor"));
    let [userRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, "user"));
    if (!userRole) {
      [userRole] = await db
        .insert(schema.roles)
        .values({ name: "user", description: "user role" })
        .returning();
      insertedUserRoleId = userRole!.id;
    }
    for (const [name, roleId, orgId] of [
      ["readOnly", null, null],
      // A grant naming a role that authorizes nothing.
      ["userOnly", userRole!.id, regionA.id],
      ["editorOnA", editorRole!.id, regionA.id],
      ["editorOnB", editorRole!.id, regionB.id],
    ] as const) {
      const [key] = await db
        .insert(schema.apiKeys)
        .values({ name: `tier-${name}`, key: keys[name], ownerId })
        .returning();
      keyIds.push(key!.id);
      if (roleId !== null) {
        await db
          .insert(schema.rolesXApiKeysXOrg)
          .values({ apiKeyId: key!.id, roleId, orgId });
      }
    }
  });

  beforeEach(async () => {
    mockLimit.mockResolvedValue({ success: true });
    await mockAuthWithSession(null);
  });

  afterAll(async () => {
    await db
      .delete(schema.rolesXApiKeysXOrg)
      .where(inArray(schema.rolesXApiKeysXOrg.apiKeyId, keyIds));
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
    if (insertedUserRoleId)
      await db
        .delete(schema.roles)
        .where(eq(schema.roles.id, insertedUserRoleId));
    if (ownerId)
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
    await db.delete(schema.orgs).where(inArray(schema.orgs.id, orgIds));
  });

  // A sample of member-tier endpoints, reads and a self-service write, that a
  // caller with no session must not reach.
  const memberOperations = {
    identity: (c: Client) => c.identity(),
    attendance: (c: Client) =>
      c.attendance.getForEventInstance({ eventInstanceId: 999999999 }),
    upcomingQs: (c: Client) =>
      c.eventInstance.getUpcomingQs({
        userId: ownerId,
        regionOrgId: regionA.id,
      }),
    memberDirectory: (c: Client) => c.me.users({ userId: ownerId }),
    planAttendance: (c: Client) =>
      c.attendance.createPlanned({
        eventInstanceId: 999999999,
        userId: ownerId,
        attendanceTypeIds: [1],
      }),
  };

  it.each(["none", "readOnly", "userOnly", "unknown"] as const)(
    "rejects credential %s on every member-tier endpoint",
    async (credential) => {
      const client = clientFor(
        credential === "none" ? undefined : keys[credential],
      );
      for (const operation of Object.values(memberOperations)) {
        await expect(operation(client)).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
    },
  );

  it.each(["member", "editorOnA", "editorOnB"] as const)(
    "lets %s through the member tier",
    async (caller) => {
      if (caller === "member") await mockAuthWithSession(memberSession());
      const client = clientFor(caller === "member" ? undefined : keys[caller]);

      expect(await client.identity()).toEqual(
        caller === "member"
          ? {
              id: ownerId,
              email: "member@example.test",
              userEmail: "member@example.test",
            }
          : // A key never stands in for the user who owns it.
            { id: API_KEY_SESSION_USER_ID, email: null, userEmail: null },
      );
      await expect(memberOperations.attendance(client)).resolves.toEqual({
        attendance: [],
      });
      expect(
        (await memberOperations.memberDirectory(client)).users.map((u) => u.id),
      ).toEqual([ownerId]);
      // Past the tier check, the handler reports the missing event instance.
      await expect(
        memberOperations.planAttendance(client),
      ).rejects.not.toMatchObject({ code: "UNAUTHORIZED" });
    },
  );

  it("does not let a key submit a change request as its owner", async () => {
    const client = clientFor(keys.editorOnA);
    await expect(
      client.request.submitDeleteEventRequest({
        id: randomUUID(),
        requestType: "delete_event",
        submittedBy: ownerEmail,
        originalEventId: 999999999,
        originalRegionId: regionA.id,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: KEY_REQUEST_MESSAGE,
    });
    expect(
      await db
        .select({ id: schema.updateRequests.id })
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.submittedBy, ownerEmail)),
    ).toEqual([]);
  });

  it("does not let a key approve or reject a change request", async () => {
    const [pending] = await db
      .insert(schema.updateRequests)
      .values({
        regionId: regionA.id,
        requestType: "delete_event",
        submittedBy: "submitter@example.test",
        status: "pending",
      })
      .returning({ id: schema.updateRequests.id });
    try {
      const client = clientFor(keys.editorOnA);
      await expect(
        client.request.validateSubmissionByAdmin({
          id: pending!.id,
          requestType: "delete_event",
          submittedBy: "submitter@example.test",
          originalEventId: 999999999,
          originalRegionId: regionA.id,
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: KEY_REQUEST_MESSAGE,
      });
      await expect(
        client.request.rejectSubmission({ id: pending!.id }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: KEY_REQUEST_MESSAGE,
      });
      const [row] = await db
        .select({
          status: schema.updateRequests.status,
          reviewedBy: schema.updateRequests.reviewedBy,
        })
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, pending!.id));
      expect(row).toEqual({ status: "pending", reviewedBy: null });
    } finally {
      await db
        .delete(schema.updateRequests)
        .where(eq(schema.updateRequests.id, pending!.id));
    }
  });

  it("gives role-less keys the anonymous view of public reads", async () => {
    const anonymous = clientFor();
    const readOnly = clientFor(keys.readOnly);
    const userOnly = clientFor(keys.userOnly);

    for (const client of [anonymous, readOnly, userOnly]) {
      expect((await client.org.byId({ id: regionA.id })).org).toMatchObject({
        id: regionA.id,
        email: null,
        phone: null,
      });
      expect((await client.org.byId({ id: retiredRegionId })).org).toBeNull();
    }
    for (const client of [readOnly, userOnly]) {
      expect(await client.org.byId({ id: regionA.id })).toEqual(
        await anonymous.org.byId({ id: regionA.id }),
      );
    }

    // A key holding a role, even on another region, sees the signed-in view.
    const withRole = clientFor(keys.editorOnB);
    expect((await withRole.org.byId({ id: regionA.id })).org).toMatchObject({
      email: "region-contact@example.test",
      phone: "555-0100",
    });
    expect(
      (await withRole.org.byId({ id: retiredRegionId })).org,
    ).toMatchObject({ id: retiredRegionId, isActive: false });
  });

  it.each(["none", "readOnly", "userOnly"] as const)(
    "serves the org chart to credential %s",
    async (credential) => {
      const client = clientFor(
        credential === "none" ? undefined : keys[credential],
      );
      expect(await client.orgChart.byId({ orgId: regionA.id })).toMatchObject({
        id: regionA.id,
        name: regionA.name,
        // Contact details on an org are public by intent.
        email: "region-contact@example.test",
        phone: "555-0100",
      });
      const { orgs } = await client.orgChart.all();
      expect(Array.isArray(orgs)).toBe(true);
    },
  );

  it.each(["member", "editorOnB"] as const)(
    "shows the org chart phone number to %s",
    async (caller) => {
      if (caller === "member") await mockAuthWithSession(memberSession());
      const client = clientFor(caller === "member" ? undefined : keys[caller]);
      expect((await client.orgChart.byId({ orgId: regionA.id })).phone).toBe(
        "555-0100",
      );
    },
  );

  describe("org chart locations and AO search", () => {
    const tag = randomUUID().slice(0, 8);
    const eventIds: number[] = [];
    const locationIds: number[] = [];
    const fx = {} as Record<
      | "liveAo"
      | "aoUnderRetiredRegion"
      | "aoUnderRetiredArea"
      | "publicLoc"
      | "privateLoc"
      | "inactiveEventLoc"
      | "emptyLoc"
      | "retiredRegionLoc"
      | "retiredAreaLoc"
      | "retiredOwnerLoc"
      | "sharedLoc",
      number
    >;

    const insertOrg = async (
      orgType: "area" | "region" | "ao",
      parentId: number,
      isActive = true,
    ) => {
      const [org] = await db
        .insert(schema.orgs)
        .values({
          name: `Tier ${orgType} ${tag} ${randomUUID()}`,
          orgType,
          parentId,
          isActive,
        })
        .returning();
      orgIds.push(org!.id);
      return org!.id;
    };
    const insertLocation = async (orgId: number) => {
      const [location] = await db
        .insert(schema.locations)
        .values({
          name: `Tier Location ${randomUUID()}`,
          orgId,
          isActive: true,
          latitude: 35.5,
          longitude: -80.5,
        })
        .returning();
      locationIds.push(location!.id);
      return location!.id;
    };
    const insertEvent = async (
      orgId: number,
      locationId: number,
      overrides: { isActive?: boolean; isPrivate?: boolean } = {},
    ) => {
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `Tier Event ${randomUUID()}`,
          orgId,
          locationId,
          dayOfWeek: "monday",
          startTime: "0530",
          isActive: overrides.isActive ?? true,
          isPrivate: overrides.isPrivate ?? false,
          highlight: false,
          startDate: "2026-01-01",
        })
        .returning();
      eventIds.push(event!.id);
    };

    beforeAll(async () => {
      const nation = await getOrCreateF3NationOrg();
      const retiredArea = await insertOrg("area", nation.id, false);
      const regionUnderRetiredArea = await insertOrg("region", retiredArea);

      fx.liveAo = await insertOrg("ao", regionA.id);
      fx.aoUnderRetiredRegion = await insertOrg("ao", retiredRegionId);
      fx.aoUnderRetiredArea = await insertOrg("ao", regionUnderRetiredArea);

      fx.publicLoc = await insertLocation(regionA.id);
      await insertEvent(fx.liveAo, fx.publicLoc);
      fx.privateLoc = await insertLocation(regionA.id);
      await insertEvent(fx.liveAo, fx.privateLoc, { isPrivate: true });
      fx.inactiveEventLoc = await insertLocation(regionA.id);
      await insertEvent(fx.liveAo, fx.inactiveEventLoc, { isActive: false });
      fx.emptyLoc = await insertLocation(regionA.id);
      // Active location and active AO, but a retired region above the AO.
      fx.retiredRegionLoc = await insertLocation(regionA.id);
      await insertEvent(fx.aoUnderRetiredRegion, fx.retiredRegionLoc);
      // Active AO and region, but a retired area above them.
      fx.retiredAreaLoc = await insertLocation(regionUnderRetiredArea);
      await insertEvent(fx.aoUnderRetiredArea, fx.retiredAreaLoc);
      // Owned by a region under a retired area, though a live AO holds two
      // public events there, which makes it that AO's busiest location.
      fx.retiredOwnerLoc = await insertLocation(regionUnderRetiredArea);
      await insertEvent(fx.liveAo, fx.retiredOwnerLoc);
      await insertEvent(fx.liveAo, fx.retiredOwnerLoc);
      // One live AO and one retired-branch AO at the same location.
      fx.sharedLoc = await insertLocation(regionA.id);
      await insertEvent(fx.liveAo, fx.sharedLoc);
      await insertEvent(fx.aoUnderRetiredArea, fx.sharedLoc);
    });

    afterAll(async () => {
      await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
      await db
        .delete(schema.locations)
        .where(inArray(schema.locations.id, locationIds));
    });

    it.each(["none", "readOnly", "userOnly"] as const)(
      "serves only eligible public locations to credential %s",
      async (credential) => {
        const client = clientFor(
          credential === "none" ? undefined : keys[credential],
        );

        expect(
          await client.orgChart.byLocation({ locationId: fx.publicLoc }),
        ).toMatchObject({
          locationId: fx.publicLoc,
          aos: [expect.objectContaining({ id: fx.liveAo })],
        });
        for (const locationId of [
          fx.privateLoc,
          fx.inactiveEventLoc,
          fx.emptyLoc,
          fx.retiredRegionLoc,
          fx.retiredAreaLoc,
          fx.retiredOwnerLoc,
        ]) {
          await expect(
            client.orgChart.byLocation({ locationId }),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        }

        const shared = await client.orgChart.byLocation({
          locationId: fx.sharedLoc,
        });
        expect(shared.aos.map((ao) => ao.id)).toEqual([fx.liveAo]);
        expect(shared.aos[0]?.eventCount).toBe(1);
      },
    );

    it.each(["none", "readOnly", "userOnly"] as const)(
      "leaves retired branches out of AO search and chart counts for credential %s",
      async (credential) => {
        const client = clientFor(
          credential === "none" ? undefined : keys[credential],
        );

        const { aos } = await client.orgChart.aos({ searchTerm: tag });
        expect(aos.map((ao) => ao.id)).toEqual([fx.liveAo]);
        expect(aos[0]?.locationId).not.toBe(fx.retiredOwnerLoc);

        const { orgs } = await client.orgChart.all();
        const region = orgs.find((org) => org?.orgId === regionA.id);
        const shared = region?.activeLocations.find(
          (location) => location.locationId === fx.sharedLoc,
        );
        expect(shared).toMatchObject({ eventCount: 1, aoCount: 1 });
        expect(
          region?.activeLocations.map((location) => location.locationId),
        ).not.toContain(fx.retiredRegionLoc);
      },
    );
  });

  describe("event instance list", () => {
    const tag = `TierInstance ${randomUUID().slice(0, 8)}`;
    const instanceIds: number[] = [];
    const locationIds: number[] = [];
    const fx = {} as Record<
      | "publicInstance"
      | "privateInstance"
      | "inactiveInstance"
      | "retiredRegionInstance"
      | "retiredLocationInstance",
      number
    >;

    const insertInstance = async (
      orgId: number,
      locationId: number | null,
      overrides: { isActive?: boolean; isPrivate?: boolean } = {},
    ) => {
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `${tag} ${randomUUID()}`,
          orgId,
          locationId,
          startDate: "2026-12-01",
          isActive: overrides.isActive ?? true,
          isPrivate: overrides.isPrivate ?? false,
          highlight: false,
          meta: { slack_channel_id: "C0TIERTEST" },
        })
        .returning();
      instanceIds.push(instance!.id);
      return instance!.id;
    };

    beforeAll(async () => {
      const insertAo = async (parentId: number) => {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: `${tag} AO`,
            orgType: "ao",
            parentId,
            isActive: true,
          })
          .returning();
        orgIds.push(org!.id);
        return org!.id;
      };
      const liveAo = await insertAo(regionA.id);
      const aoUnderRetiredRegion = await insertAo(retiredRegionId);
      const [retiredLocation] = await db
        .insert(schema.locations)
        .values({ name: `${tag} Gone`, orgId: regionA.id, isActive: false })
        .returning();
      locationIds.push(retiredLocation!.id);

      fx.publicInstance = await insertInstance(liveAo, null);
      fx.privateInstance = await insertInstance(liveAo, null, {
        isPrivate: true,
      });
      fx.inactiveInstance = await insertInstance(liveAo, null, {
        isActive: false,
      });
      fx.retiredRegionInstance = await insertInstance(
        aoUnderRetiredRegion,
        null,
      );
      fx.retiredLocationInstance = await insertInstance(
        liveAo,
        retiredLocation!.id,
      );
    });

    afterAll(async () => {
      await db
        .delete(schema.eventInstances)
        .where(inArray(schema.eventInstances.id, instanceIds));
      await db
        .delete(schema.locations)
        .where(inArray(schema.locations.id, locationIds));
    });

    const listIds = async (
      client: Client,
      statuses?: ("active" | "inactive")[],
    ) => {
      const { eventInstances } = await client.eventInstance.all({
        searchTerm: tag,
        statuses,
      });
      return eventInstances.map((instance) => instance.id).sort();
    };

    it.each(["none", "readOnly", "userOnly"] as const)(
      "serves only public, live instances to credential %s",
      async (credential) => {
        const client = clientFor(
          credential === "none" ? undefined : keys[credential],
        );

        const { eventInstances } = await client.eventInstance.all({
          searchTerm: tag,
        });
        expect(eventInstances.map((instance) => instance.id)).toEqual([
          fx.publicInstance,
        ]);
        // Slack channel ids and other settings in meta stay private.
        expect(eventInstances[0]?.meta).toBeNull();

        // Asking for inactive instances does not reveal them: like
        // `event.all`, the status filter is clamped to active.
        for (const statuses of [
          ["active", "inactive"],
          ["inactive"],
        ] as const) {
          expect(await listIds(client, [...statuses])).toEqual([
            fx.publicInstance,
          ]);
        }
      },
    );

    it.each(["member", "editorOnB"] as const)(
      "keeps the full list for %s",
      async (caller) => {
        if (caller === "member") await mockAuthWithSession(memberSession());
        const client = clientFor(
          caller === "member" ? undefined : keys[caller],
        );

        expect(await listIds(client, ["active", "inactive"])).toEqual(
          Object.values(fx).sort(),
        );
        const { eventInstances } = await client.eventInstance.all({
          searchTerm: tag,
        });
        expect(
          eventInstances.find((instance) => instance.id === fx.publicInstance)
            ?.meta,
        ).toEqual({ slack_channel_id: "C0TIERTEST" });
      },
    );
  });
});
