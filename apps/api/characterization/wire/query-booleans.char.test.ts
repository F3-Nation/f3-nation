import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getOrCreateF3NationOrg, uniqueId } from "@acme/api/testing";
import { eq, inArray, schema } from "@acme/db";

import type { FixtureApiKey } from "../fixtures/api-keys";
import { createApiKey } from "../fixtures/api-keys";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

interface EventList {
  events: { id: number }[];
  totalCount: number;
}

interface AttendanceList {
  attendance: { id: number; isPlanned: boolean }[];
}

const booleanCases = [
  ["false", false],
  ["0", false],
  ["true", true],
  ["1", true],
] as const;

/**
 * Real Requests traverse Hono dispatch, OpenAPI query deserialization and auth.
 * The RPC cases use the actual client codec. Shared-database gating also lets
 * the built-bundle CI leg run these fixtures without touching Staging data.
 */
describe.runIf(target.sharesDatabase)("boolean query options", () => {
  const prefix = `Query booleans ${uniqueId()}`;
  const orgIds: number[] = [];
  const eventIds: number[] = [];
  const tagIds: number[] = [];
  let apiKey: FixtureApiKey | undefined;
  let eventInstanceId: number | undefined;
  let mineEventId: number;
  let plannedAttendanceId: number;
  let actualAttendanceId: number;
  let requestIndex = 0;

  const headers = () => ({
    authorization: `Bearer ${apiKey!.key}`,
    "x-forwarded-for": `10.97.0.${++requestIndex}`,
  });

  const rest = (path: string, query: Record<string, string> = {}) =>
    target.invoke(
      req(`${path}?${new URLSearchParams(query).toString()}`, {
        // API-key resolution requires a client header; this value preserves
        // OpenAPI dispatch while rpcResponse supplies the real RPC header.
        headers: { ...headers(), client: "characterization" },
      }),
    );

  beforeAll(async () => {
    const nation = await getOrCreateF3NationOrg();
    for (const label of ["Mine", "Other"]) {
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix} ${label}`,
          orgType: "region",
          parentId: nation.id,
          isActive: true,
        })
        .returning({ id: schema.orgs.id });
      if (!region) throw new Error("failed to insert boolean fixture region");
      orgIds.push(region.id);

      const [event] = await db
        .insert(schema.events)
        .values({
          name: `${prefix} ${label}`,
          orgId: region.id,
          startDate: "2026-01-01",
          startTime: "0600",
          dayOfWeek: "monday",
          isActive: true,
          isPrivate: false,
          highlight: false,
        })
        .returning({ id: schema.events.id });
      if (!event) throw new Error("failed to insert boolean fixture event");
      eventIds.push(event.id);
    }

    mineEventId = eventIds[0]!;
    apiKey = await createApiKey({
      roles: [{ orgId: orgIds[0]!, roleName: "editor" }],
    });

    for (const label of ["First", "Second"]) {
      const [tag] = await db
        .insert(schema.eventTags)
        .values({
          name: `${prefix} ${label}`,
          specificOrgId: orgIds[0]!,
          isActive: true,
        })
        .returning({ id: schema.eventTags.id });
      if (!tag) throw new Error("failed to insert boolean fixture tag");
      tagIds.push(tag.id);
    }

    const [instance] = await db
      .insert(schema.eventInstances)
      .values({
        name: prefix,
        orgId: orgIds[0]!,
        seriesId: mineEventId,
        startDate: "2026-01-01",
        isActive: true,
        highlight: false,
      })
      .returning({ id: schema.eventInstances.id });
    if (!instance) throw new Error("failed to insert boolean fixture instance");
    eventInstanceId = instance.id;

    for (const isPlanned of [true, false]) {
      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId,
          userId: apiKey.ownerId,
          isPlanned,
        })
        .returning({ id: schema.attendance.id });
      if (!attendance) {
        throw new Error("failed to insert boolean fixture attendance");
      }
      if (isPlanned) plannedAttendanceId = attendance.id;
      else actualAttendanceId = attendance.id;
    }
  });

  afterAll(async () => {
    if (eventInstanceId !== undefined) {
      await db
        .delete(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, eventInstanceId));
      await db
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, eventInstanceId));
    }
    if (tagIds.length) {
      await db
        .delete(schema.eventTags)
        .where(inArray(schema.eventTags.id, tagIds));
    }
    if (eventIds.length) {
      await db.delete(schema.events).where(inArray(schema.events.id, eventIds));
    }
    await apiKey?.cleanup();
    if (orgIds.length) {
      await db.delete(schema.orgs).where(inArray(schema.orgs.id, orgIds));
    }
  });

  it.each(booleanCases)(
    "sorts events with REST desc=%s",
    async (value, descending) => {
      const res = await rest("/v1/event", {
        searchTerm: prefix,
        "sorting[0][id]": "id",
        "sorting[0][desc]": value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventList;
      expect(body.totalCount).toBe(2);
      expect(body.events.map(({ id }) => id)).toEqual(
        descending ? [...eventIds].reverse() : eventIds,
      );
    },
  );

  it.each(booleanCases)(
    "scopes map events with REST onlyMine=%s",
    async (value, onlyMine) => {
      const res = await rest("/v1/map/event/all", {
        searchTerm: prefix,
        onlyMine: value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventList;
      expect(body.totalCount).toBe(onlyMine ? 1 : 2);
      expect(body.events.map(({ id }) => id)).toEqual(
        onlyMine ? [mineEventId] : [...eventIds].reverse(),
      );
    },
  );

  it("preserves actual RPC false for event sorting", async () => {
    const res = await rpcResponse(
      (client) =>
        client.event.all({
          searchTerm: prefix,
          sorting: [{ id: "id", desc: false }],
        }),
      headers(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: EventList };
    expect(body.json.events.map(({ id }) => id)).toEqual(eventIds);
  });

  it("preserves actual RPC false for onlyMine", async () => {
    const res = await rpcResponse(
      (client) => client.map.event.all({ searchTerm: prefix, onlyMine: false }),
      headers(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: EventList };
    expect(body.json.totalCount).toBe(2);
    expect(body.json.events.map(({ id }) => id)).toEqual(
      [...eventIds].reverse(),
    );
  });

  it.each(["false", "0"])(
    "accepts nested string desc=%s in the shared tag sorting parser",
    async (value) => {
      const res = await rest("/v1/event-tag", {
        searchTerm: prefix,
        "sorting[0][id]": "id",
        "sorting[0][desc]": value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        eventTags: { id: number }[];
        totalCount: number;
      };
      expect(body.totalCount).toBe(2);
      expect(body.eventTags.map(({ id }) => id)).toEqual(tagIds);
    },
  );

  it("keeps attendance's omitted isPlanned default true", async () => {
    const res = await rest(`/v1/attendance/event-instance/${eventInstanceId!}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceList;
    expect(body.attendance.map(({ id }) => id)).toEqual([plannedAttendanceId]);
    expect(body.attendance[0]?.isPlanned).toBe(true);
  });

  it.each(["false", "0"])(
    "selects actual attendance with REST isPlanned=%s",
    async (value) => {
      const res = await rest(
        `/v1/attendance/event-instance/${eventInstanceId!}`,
        {
          isPlanned: value,
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AttendanceList;
      expect(body.attendance.map(({ id }) => id)).toEqual([actualAttendanceId]);
      expect(body.attendance[0]?.isPlanned).toBe(false);
    },
  );

  it("preserves actual RPC false for attendance", async () => {
    const res = await rpcResponse(
      (client) =>
        client.attendance.getForEventInstance({
          eventInstanceId: eventInstanceId!,
          isPlanned: false,
        }),
      headers(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: AttendanceList };
    expect(body.json.attendance.map(({ id }) => id)).toEqual([
      actualAttendanceId,
    ]);
  });

  const invalidQueries: {
    label: string;
    path: string;
    query: Record<string, string>;
  }[] = [
    {
      label: "map onlyMine",
      path: "/v1/map/event/all",
      query: { onlyMine: "not-a-boolean" },
    },
    {
      label: "event descending",
      path: "/v1/event",
      query: { "sorting[0][id]": "id", "sorting[0][desc]": "not-a-boolean" },
    },
  ];

  it.each(invalidQueries)(
    "rejects invalid $label with HTTP 400",
    async ({ path, query }) => {
      const res = await rest(path, query);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    },
  );

  it("rejects invalid attendance isPlanned with HTTP 400", async () => {
    const res = await rest(
      `/v1/attendance/event-instance/${eventInstanceId!}`,
      {
        isPlanned: "not-a-boolean",
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
  });
});
