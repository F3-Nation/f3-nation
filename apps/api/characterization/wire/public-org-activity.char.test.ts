import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getOrCreateF3NationOrg, uniqueId } from "@acme/api/testing";
import { eq, inArray, schema } from "@acme/db";

import { sessionCookie } from "../fixtures/cookies";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

interface Branch {
  aoId: number;
  eventId: number;
  locationId: number;
  typeId: number;
}

// Shared-database gating exercises real auth and both wire transports locally
// and against CI's built bundle, without inserting fixtures into remote data.
describe.runIf(target.sharesDatabase)("public organization activity", () => {
  const prefix = `Public hierarchy ${uniqueId()}`;
  const orgIds: number[] = [];
  const eventIds: number[] = [];
  const locationIds: number[] = [];
  const typeIds: number[] = [];
  const branches: Branch[] = [];
  let cookie: string;
  let requestIndex = 0;

  const headers = (authenticated: boolean) => ({
    "x-forwarded-for": `10.98.0.${++requestIndex}`,
    ...(authenticated ? { cookie } : {}),
  });

  beforeAll(async () => {
    cookie = await sessionCookie({ roles: [] });
    const nation = await getOrCreateF3NationOrg();
    for (const isActive of [true, false]) {
      const [area] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix} area ${isActive}`,
          orgType: "area",
          parentId: nation.id,
          isActive,
        })
        .returning();
      orgIds.push(area!.id);
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix} region ${isActive}`,
          orgType: "region",
          parentId: area!.id,
          isActive: true,
        })
        .returning();
      orgIds.push(region!.id);
      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix} AO ${isActive}`,
          orgType: "ao",
          parentId: region!.id,
          isActive: true,
        })
        .returning();
      orgIds.push(ao!.id);
      const [location] = await db
        .insert(schema.locations)
        .values({
          name: `${prefix} location ${isActive}`,
          orgId: region!.id,
          isActive: true,
          latitude: 35.5,
          longitude: -80.5,
        })
        .returning();
      locationIds.push(location!.id);
      const [event] = await db
        .insert(schema.events)
        .values({
          name: `${prefix} event ${isActive}`,
          orgId: ao!.id,
          locationId: location!.id,
          startDate: "2026-01-01",
          isActive: true,
          isPrivate: false,
          highlight: false,
        })
        .returning();
      eventIds.push(event!.id);
      const [type] = await db
        .insert(schema.eventTypes)
        .values({
          name: `${prefix} type ${isActive}`,
          specificOrgId: ao!.id,
          eventCategory: "first_f",
          isActive: true,
        })
        .returning();
      typeIds.push(type!.id);
      branches.push({
        aoId: ao!.id,
        eventId: event!.id,
        locationId: location!.id,
        typeId: type!.id,
      });
    }
  });

  afterAll(async () => {
    if (eventIds.length)
      await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
    if (typeIds.length)
      await db
        .delete(schema.eventTypes)
        .where(inArray(schema.eventTypes.id, typeIds));
    if (locationIds.length)
      await db
        .delete(schema.locations)
        .where(inArray(schema.locations.id, locationIds));
    for (const id of [...orgIds].reverse())
      await db.delete(schema.orgs).where(eq(schema.orgs.id, id));
  });

  it.each([false, true])(
    "filters REST lists according to actual session presence: authenticated=%s",
    async (authenticated) => {
      const visible = authenticated ? branches : branches.slice(0, 1);
      for (const [path, field, totalField, ids, extra] of [
        [
          "org",
          "orgs",
          "total",
          visible.map((b) => b.aoId),
          { orgTypes: "ao" },
        ],
        ["event", "events", "totalCount", visible.map((b) => b.eventId), {}],
        [
          "location",
          "locations",
          "totalCount",
          visible.map((b) => b.locationId),
          {},
        ],
        [
          "event-type",
          "eventTypes",
          "totalCount",
          visible.map((b) => b.typeId),
          {},
        ],
      ] as const) {
        const query = new URLSearchParams({ searchTerm: prefix, ...extra });
        const res = await target.invoke(
          req(`/v1/${path}?${query}`, {
            headers: { ...headers(authenticated), client: "characterization" },
          }),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<
          string,
          number | { id: number }[]
        >;
        expect(body[totalField]).toBe(visible.length);
        expect(
          (body[field] as { id: number }[])
            .map(({ id }) => id)
            .sort((a, b) => a - b),
        ).toEqual([...ids].sort((a, b) => a - b));
      }
    },
  );

  it.each([false, true])(
    "filters guessed IDs over RPC with real auth: authenticated=%s",
    async (authenticated) => {
      const hidden = branches[1]!;
      const org = await rpcResponse(
        (client) => client.org.byId({ id: hidden.aoId }),
        headers(authenticated),
      );
      expect(org.status).toBe(200);
      expect(await org.json()).toMatchObject({
        json: { org: authenticated ? { id: hidden.aoId } : null },
      });
      const event = await rpcResponse(
        (client) => client.event.byId({ id: hidden.eventId }),
        headers(authenticated),
      );
      expect(event.status).toBe(200);
      expect(await event.json()).toMatchObject({
        json: { event: authenticated ? { id: hidden.eventId } : null },
      });
    },
  );
});
