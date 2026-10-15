import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getOrCreateF3NationOrg, uniqueId } from "@acme/api/testing";
import { eq, inArray, schema } from "@acme/db";

import type { FixtureApiKey } from "../fixtures/api-keys";
import { createApiKey } from "../fixtures/api-keys";
import { sessionCookie } from "../fixtures/cookies";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

interface EventList {
  events: { id: number }[];
  totalCount: number;
}

interface AttendanceList {
  attendance: { id: number; isPlanned: boolean }[];
}

interface EventInstanceList {
  eventInstances: { id: number; startDate: string }[];
  totalCount: number;
}

interface EventTagList {
  eventTags: { id: number; isActive: boolean }[];
  totalCount: number;
}

const booleanCases = [
  ["false", false],
  ["0", false],
  ["true", true],
  ["1", true],
] as const;

/**
 * Real Requests traverse Hono dispatch, OpenAPI input deserialization and auth.
 * The RPC cases use the actual client codec. Shared-database gating also lets
 * the built-bundle CI leg run these fixtures without touching Staging data.
 */
describe.runIf(target.sharesDatabase)("boolean query options", () => {
  const prefix = `Query booleans ${uniqueId()}`;
  const orgIds: number[] = [];
  const eventIds: number[] = [];
  const tagIds: number[] = [];
  const activeRegionTagIds: number[] = [];
  const eventInstanceIds: number[] = [];
  let apiKey: FixtureApiKey | undefined;
  let eventInstanceId: number | undefined;
  let standaloneInstanceId: number;
  let inactiveTagId: number;
  let nationTagId: number;
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

    for (const [label, isActive, specificOrgId] of [
      ["First", true, orgIds[0]!],
      ["Second", true, orgIds[0]!],
      ["Inactive", false, orgIds[0]!],
      ["Nation", true, null],
    ] as const) {
      const [tag] = await db
        .insert(schema.eventTags)
        .values({
          name: `${prefix} ${label}`,
          specificOrgId,
          isActive,
        })
        .returning({ id: schema.eventTags.id });
      if (!tag) throw new Error("failed to insert boolean fixture tag");
      tagIds.push(tag.id);
      if (specificOrgId === null) nationTagId = tag.id;
      else if (isActive) activeRegionTagIds.push(tag.id);
      else inactiveTagId = tag.id;
    }

    for (const [label, seriesId, startDate] of [
      ["Series", mineEventId, "2026-01-01"],
      ["Standalone", null, "2026-01-02"],
    ] as const) {
      const [instance] = await db
        .insert(schema.eventInstances)
        .values({
          name: `${prefix} ${label}`,
          orgId: orgIds[0]!,
          seriesId,
          startDate,
          isActive: true,
          highlight: false,
        })
        .returning({ id: schema.eventInstances.id });
      if (!instance) {
        throw new Error("failed to insert boolean fixture instance");
      }
      eventInstanceIds.push(instance.id);
      if (seriesId === null) standaloneInstanceId = instance.id;
      else eventInstanceId = instance.id;
    }

    if (eventInstanceId === undefined) {
      throw new Error("failed to insert boolean fixture series instance");
    }
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
    if (eventInstanceIds.length) {
      await db
        .delete(schema.attendance)
        .where(inArray(schema.attendance.eventInstanceId, eventInstanceIds));
      await db
        .delete(schema.eventInstances)
        .where(inArray(schema.eventInstances.id, eventInstanceIds));
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
    "sorts map events with REST desc=%s",
    async (value, descending) => {
      const res = await rest("/v1/map/event/all", {
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
    "sorts event instances by startDate with REST desc=%s",
    async (value, descending) => {
      const res = await rest("/v1/event-instance", {
        searchTerm: prefix,
        "sorting[0][id]": "startDate",
        "sorting[0][desc]": value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventInstanceList;
      expect(body.totalCount).toBe(2);
      expect(body.eventInstances.map(({ id }) => id)).toEqual(
        descending ? [...eventInstanceIds].reverse() : eventInstanceIds,
      );
      expect(body.eventInstances.map(({ startDate }) => startDate)).toEqual(
        descending
          ? ["2026-01-02", "2026-01-01"]
          : ["2026-01-01", "2026-01-02"],
      );
    },
  );

  it.each([
    { path: "/v1/event", sortKey: "id" },
    { path: "/v1/map/event/all", sortKey: "id" },
    { path: "/v1/event-instance", sortKey: "startDate" },
  ])(
    "keeps omitted REST desc required for $path",
    async ({ path, sortKey }) => {
      const res = await rest(path, {
        searchTerm: prefix,
        "sorting[0][id]": sortKey,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    },
  );

  it.each(booleanCases)(
    "filters event instances with REST onlyStandalone=%s",
    async (value, onlyStandalone) => {
      const res = await rest("/v1/event-instance", {
        searchTerm: prefix,
        onlyStandalone: value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventInstanceList;
      expect(body.totalCount).toBe(onlyStandalone ? 1 : 2);
      expect(body.eventInstances.map(({ id }) => id)).toEqual(
        onlyStandalone ? [standaloneInstanceId] : eventInstanceIds,
      );
    },
  );

  it("keeps both event instances when onlyStandalone is omitted", async () => {
    const res = await rest("/v1/event-instance", { searchTerm: prefix });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventInstanceList;
    expect(body.totalCount).toBe(2);
    expect(body.eventInstances.map(({ id }) => id)).toEqual(eventInstanceIds);
  });

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

  it("defaults omitted RPC sorting desc to ascending in the shared parser", async () => {
    const res = await rpcResponse(
      (client) =>
        client.eventTag.all({
          searchTerm: prefix,
          orgIds: [orgIds[0]!],
          statuses: ["active"],
          ignoreNationEventTags: true,
          sorting: [{ id: "id" }],
        }),
      headers(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: EventTagList };
    expect(body.json.totalCount).toBe(2);
    expect(body.json.eventTags.map(({ id }) => id)).toEqual(activeRegionTagIds);
  });

  it.each(["false", "0"])(
    "restores a revoked API key with REST revoke=%s",
    async (value) => {
      const revokedKey = await createApiKey({
        revoked: true,
        roles: [{ orgId: orgIds[0]!, roleName: "editor" }],
      });
      try {
        const [before] = await db
          .select({ revokedAt: schema.apiKeys.revokedAt })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, revokedKey.apiKeyId));
        expect(before?.revokedAt).toBeTypeOf("string");

        const cookie = await sessionCookie({
          id: String(revokedKey.ownerId),
          roles: [
            {
              orgId: orgIds[0]!,
              orgName: `${prefix} Mine`,
              roleName: "admin",
            },
          ],
        });
        // Management requires a user session; POST inputs use the JSON body.
        const res = await target.invoke(
          req(`/v1/api-key/${revokedKey.apiKeyId}/revoke`, {
            method: "POST",
            headers: {
              cookie,
              client: "characterization",
              "content-type": "application/json",
              "x-forwarded-for": `10.97.0.${++requestIndex}`,
            },
            body: JSON.stringify({ revoke: value }),
          }),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          apiKey: { id: revokedKey.apiKeyId, revokedAt: null },
        });
        const [stored] = await db
          .select({ revokedAt: schema.apiKeys.revokedAt })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, revokedKey.apiKeyId));
        expect(stored).toEqual({ revokedAt: null });
      } finally {
        await revokedKey.cleanup();
      }
    },
  );

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
        orgIds: String(orgIds[0]!),
        statuses: "active",
        ignoreNationEventTags: "true",
        "sorting[0][id]": "id",
        "sorting[0][desc]": value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventTagList;
      expect(body.totalCount).toBe(2);
      expect(body.eventTags.map(({ id }) => id)).toEqual(activeRegionTagIds);
    },
  );

  it.each(booleanCases)(
    "filters nation event tags with REST ignoreNationEventTags=%s",
    async (value, ignoreNationEventTags) => {
      const res = await rest("/v1/event-tag", {
        searchTerm: prefix,
        orgIds: String(orgIds[0]!),
        statuses: "active",
        ignoreNationEventTags: value,
        "sorting[0][id]": "id",
        "sorting[0][desc]": "false",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventTagList;
      expect(body.totalCount).toBe(ignoreNationEventTags ? 2 : 3);
      expect(body.eventTags.map(({ id }) => id)).toEqual(
        ignoreNationEventTags
          ? activeRegionTagIds
          : [...activeRegionTagIds, nationTagId],
      );
    },
  );

  it("keeps nation event tags when ignoreNationEventTags is omitted", async () => {
    const res = await rest("/v1/event-tag", {
      searchTerm: prefix,
      orgIds: String(orgIds[0]!),
      statuses: "active",
      "sorting[0][id]": "id",
      "sorting[0][desc]": "false",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventTagList;
    expect(body.totalCount).toBe(3);
    expect(body.eventTags.map(({ id }) => id)).toEqual([
      ...activeRegionTagIds,
      nationTagId,
    ]);
  });

  it.each(booleanCases)(
    "selects organization event tags with REST isActive=%s",
    async (value, isActive) => {
      const res = await rest(`/v1/event-tag/org/${orgIds[0]!}`, {
        isActive: value,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Pick<EventTagList, "eventTags">;
      expect(body.eventTags.map(({ id }) => id).sort((a, b) => a - b)).toEqual(
        isActive ? activeRegionTagIds : [inactiveTagId],
      );
      expect(body.eventTags.every((tag) => tag.isActive === isActive)).toBe(
        true,
      );
    },
  );

  it("keeps organization event tags' omitted isActive default true", async () => {
    const res = await rest(`/v1/event-tag/org/${orgIds[0]!}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Pick<EventTagList, "eventTags">;
    expect(body.eventTags.map(({ id }) => id).sort((a, b) => a - b)).toEqual(
      activeRegionTagIds,
    );
    expect(body.eventTags.every(({ isActive }) => isActive)).toBe(true);
  });

  it("keeps attendance's omitted isPlanned default true", async () => {
    const res = await rest(`/v1/attendance/event-instance/${eventInstanceId!}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceList;
    expect(body.attendance.map(({ id }) => id)).toEqual([plannedAttendanceId]);
    expect(body.attendance[0]?.isPlanned).toBe(true);
  });

  it.each([...booleanCases, ["True", true], ["False", false]] as const)(
    "selects attendance with REST isPlanned=%s",
    async (value, isPlanned) => {
      const res = await rest(
        `/v1/attendance/event-instance/${eventInstanceId!}`,
        {
          isPlanned: value,
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AttendanceList;
      expect(body.attendance.map(({ id }) => id)).toEqual([
        isPlanned ? plannedAttendanceId : actualAttendanceId,
      ]);
      expect(body.attendance[0]?.isPlanned).toBe(isPlanned);
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
    {
      label: "event instance onlyStandalone",
      path: "/v1/event-instance",
      query: { onlyStandalone: "not-a-boolean" },
    },
    {
      label: "event instance descending",
      path: "/v1/event-instance",
      query: {
        "sorting[0][id]": "startDate",
        "sorting[0][desc]": "not-a-boolean",
      },
    },
    {
      label: "nation event tags",
      path: "/v1/event-tag",
      query: { ignoreNationEventTags: "not-a-boolean" },
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

  it("rejects invalid organization event tags isActive with HTTP 400", async () => {
    const res = await rest(`/v1/event-tag/org/${orgIds[0]!}`, {
      isActive: "not-a-boolean",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each(["not-a-boolean", "TRUE", "yes", ""])(
    "rejects invalid attendance isPlanned=%s with HTTP 400",
    async (value) => {
      const res = await rest(
        `/v1/attendance/event-instance/${eventInstanceId!}`,
        {
          isPlanned: value,
        },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    },
  );
});
