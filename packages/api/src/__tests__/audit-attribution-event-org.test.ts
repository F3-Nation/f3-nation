import { ORPCError } from "@orpc/server";
import { eq, inArray, schema, sql } from "@acme/db";
import { mail } from "@acme/mail";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as cascadeService from "../lib/cascade-service";
import * as firstEventService from "../lib/first-event-service";
import { notifyWebhooks } from "../lib/notify-webhooks";
import { waitForEventRegionNotificationTasks } from "../router/event";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "./test-utils";

type HistoryTable =
  | "orgs"
  | "locations"
  | "events"
  | "event_instances"
  | "events_x_event_types"
  | "event_tags_x_events"
  | "event_instances_x_event_types"
  | "event_tags_x_event_instances";

const history = (table: HistoryTable, key: string, id: number, op?: string) =>
  db.execute<{
    op: string;
    changed_by: number | null;
    changed_via: string | null;
    new_row: Record<string, unknown> | null;
  }>(sql`
    SELECT op, changed_by, changed_via, new_row
    FROM public_history.${sql.identifier(table)}
    WHERE COALESCE(new_row, old_row)->>${key} = ${String(id)}
      ${op ? sql`AND op = ${op}` : sql``}
    ORDER BY id
  `);

const futureMonday = (offset: number) => {
  const date = new Date();
  date.setUTCDate(
    date.getUTCDate() + ((1 - date.getUTCDay() + 7) % 7 || 7) + offset * 7,
  );
  return date.toISOString().slice(0, 10);
};

describe("event and organization audit attribution", () => {
  const eventIds: number[] = [];
  const eventTypeIds: number[] = [];
  const eventTagIds: number[] = [];
  const locationIds: number[] = [];
  const orgIds: number[] = [];

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await mockAuthWithSession(await createAdminSession());
  });

  afterAll(async () => {
    await waitForEventRegionNotificationTasks();
    if (eventIds.length) {
      await db
        .delete(schema.eventInstances)
        .where(inArray(schema.eventInstances.seriesId, eventIds));
    }
    for (const id of eventIds.reverse()) await cleanup.event(id);
    for (const id of eventTagIds.reverse()) {
      await db.delete(schema.eventTags).where(eq(schema.eventTags.id, id));
    }
    for (const id of eventTypeIds.reverse()) await cleanup.eventType(id);
    for (const id of locationIds.reverse()) await cleanup.location(id);
    for (const id of orgIds.reverse()) await cleanup.org(id);
    vi.restoreAllMocks();
  });

  const fixture = async () => {
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Audit region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Missing synthetic region");
    orgIds.push(region.id);
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Audit AO ${uniqueId()}`,
        orgType: "ao",
        parentId: region.id,
        isActive: true,
      })
      .returning();
    if (!ao) throw new Error("Missing synthetic AO");
    orgIds.push(ao.id);
    const [eventType] = await db
      .insert(schema.eventTypes)
      .values({ name: `Audit type ${uniqueId()}`, eventCategory: "first_f" })
      .returning();
    if (!eventType) throw new Error("Missing synthetic event type");
    eventTypeIds.push(eventType.id);
    const [tag] = await db
      .insert(schema.eventTags)
      .values({ name: `Audit tag ${uniqueId()}`, isActive: true })
      .returning();
    if (!tag) throw new Error("Missing synthetic event tag");
    eventTagIds.push(tag.id);
    const input = {
      name: `Audit series ${uniqueId()}`,
      aoId: ao.id,
      regionId: region.id,
      locationId: null,
      dayOfWeek: "monday" as const,
      startTime: "0530",
      endTime: "0615",
      startDate: futureMonday(0),
      endDate: futureMonday(1),
      recurrencePattern: "weekly" as const,
      recurrenceInterval: 1,
      indexWithinInterval: null,
      highlight: false,
      isActive: true,
      eventTypeIds: [eventType.id],
      eventTagIds: [tag.id],
      email: null,
    };
    return { region, ao, input };
  };

  const createSeries = async (
    input: Awaited<ReturnType<typeof fixture>>["input"],
  ) => {
    const { event } = await createTestClient().event.crupdate(input);
    if (!event) throw new Error("Missing created event");
    eventIds.push(event.id);
    await waitForEventRegionNotificationTasks();
    return event;
  };

  const expectActor = (rows: Awaited<ReturnType<typeof history>>) => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ changed_by: 1, changed_via: null });
    }
  };

  const expectInactiveCascade = async (aoId: number, eventId: number) => {
    for (const [table, key, id] of [
      ["orgs", "id", aoId],
      ["events", "id", eventId],
      ["event_instances", "series_id", eventId],
    ] as const) {
      const rows = await history(table, key, id, "U");
      expectActor(rows);
      for (const row of rows) expect(row.new_row?.is_active).toBe(false);
    }
  };

  it("attributes event creation, joins and generated future instances", async () => {
    const { input } = await fixture();
    const event = await createSeries(input);
    expectActor(await history("events", "id", event.id, "I"));
    for (const table of [
      "events_x_event_types",
      "event_tags_x_events",
    ] as const) {
      expectActor(await history(table, "event_id", event.id, "I"));
    }
    const instances = await history(
      "event_instances",
      "series_id",
      event.id,
      "I",
    );
    expect(instances).toHaveLength(2);
    expectActor(instances);
    for (const instance of instances) {
      for (const table of [
        "event_instances_x_event_types",
        "event_tags_x_event_instances",
      ] as const) {
        expectActor(
          await history(
            table,
            "event_instance_id",
            Number(instance.new_row?.id),
            "I",
          ),
        );
      }
    }
  });

  it("attributes event updates and replacement of series and instance joins", async () => {
    const { input } = await fixture();
    const event = await createSeries(input);
    await createTestClient().event.crupdate({
      ...input,
      id: event.id,
      name: "Updated audit series",
      eventTagIds: [],
    });
    const rows = await history("events", "id", event.id, "U");
    expectActor(rows);
    expect(rows.at(-1)?.new_row?.name).toBe("Updated audit series");
    expectActor(
      await history("events_x_event_types", "event_id", event.id, "D"),
    );
    expectActor(
      await history("event_tags_x_events", "event_id", event.id, "D"),
    );
    const instances = await history(
      "event_instances",
      "series_id",
      event.id,
      "U",
    );
    expect(instances).toHaveLength(2);
    expectActor(instances);
    for (const instance of instances) {
      expect(instance.new_row?.name).toBe("Updated audit series");
      expectActor(
        await history(
          "event_tags_x_event_instances",
          "event_instance_id",
          Number(instance.new_row?.id),
          "D",
        ),
      );
    }
  });

  it("attributes event deletion and its future-instance cascade", async () => {
    const { input } = await fixture();
    const event = await createSeries(input);
    vi.mocked(notifyWebhooks).mockClear();
    expect(await createTestClient().event.delete({ id: event.id })).toEqual({
      eventId: event.id,
    });
    expect(notifyWebhooks).toHaveBeenCalledTimes(1);
    for (const [table, key] of [
      ["events", "id"],
      ["event_instances", "series_id"],
    ] as const) {
      const rows = await history(table, key, event.id, "U");
      expectActor(rows);
      for (const row of rows) expect(row.new_row?.is_active).toBe(false);
    }
  });

  it("attributes organization creation", async () => {
    const { region } = await fixture();
    const { org } = await createTestClient().org.crupdate({
      name: "Created audit AO",
      orgType: "ao",
      parentId: region.id,
      isActive: true,
      email: null,
      phone: null,
      description: null,
      website: null,
      twitter: null,
      facebook: null,
      instagram: null,
    });
    if (!org) throw new Error("Missing created organization");
    orgIds.push(org.id);
    const rows = await history("orgs", "id", org.id, "I");
    expectActor(rows);
    expect(rows[0]?.new_row?.name).toBe("Created audit AO");
  });

  it("attributes an AO move and all location-helper writes to the same actor", async () => {
    const { region, ao, input } = await fixture();
    const [destination] = await db
      .insert(schema.orgs)
      .values({
        name: `Audit destination ${uniqueId()}`,
        orgType: "region",
        parentId: region.parentId,
        isActive: true,
      })
      .returning();
    if (!destination) throw new Error("Missing destination region");
    orgIds.unshift(destination.id);
    const [oldLocation] = await db
      .insert(schema.locations)
      .values({
        name: `Audit move location ${uniqueId()}`,
        orgId: region.id,
        latitude: 35.5,
        longitude: -80.5,
        isActive: true,
      })
      .returning();
    if (!oldLocation) throw new Error("Missing source location");
    locationIds.push(oldLocation.id);
    const { event } = await createTestClient().event.crupdate({
      ...input,
      locationId: oldLocation.id,
    });
    if (!event) throw new Error("Missing located event");
    eventIds.push(event.id);
    await waitForEventRegionNotificationTasks();

    const notifyRegion = vi
      .spyOn(firstEventService, "maybeNotifyRegionInABox")
      .mockResolvedValue();
    await createTestClient().org.crupdate({
      id: ao.id,
      name: ao.name,
      orgType: "ao",
      parentId: destination.id,
      isActive: true,
      email: null,
      phone: null,
      description: null,
      website: null,
      twitter: null,
      facebook: null,
      instagram: null,
    });
    const copiedLocations = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.orgId, destination.id));
    locationIds.push(...copiedLocations.map((location) => location.id));
    await vi.waitFor(() =>
      expect(notifyRegion).toHaveBeenCalledWith(db, destination.id),
    );
    expect(notifyRegion).toHaveBeenCalledTimes(1);
    expect(copiedLocations).toHaveLength(1);
    const newLocation = copiedLocations[0];
    if (!newLocation) throw new Error("Missing copied location");
    expect(newLocation).toMatchObject({
      name: oldLocation.name,
      orgId: destination.id,
      isActive: true,
    });
    expect(newLocation.id).not.toBe(oldLocation.id);

    for (const [table, id, op, expected] of [
      ["locations", newLocation.id, "I", { org_id: destination.id }],
      ["locations", oldLocation.id, "U", { is_active: false }],
      ["events", event.id, "U", { location_id: newLocation.id }],
      ["orgs", ao.id, "U", { parent_id: destination.id }],
    ] as const) {
      const rows = await history(table, "id", id, op);
      expect(rows).toHaveLength(1);
      expectActor(rows);
      expect(rows[0]?.new_row).toMatchObject(expected);
    }

    const [persistedEvent] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    const [persistedOrg] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, ao.id));
    const [persistedOldLocation] = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, oldLocation.id));
    expect(persistedEvent?.locationId).toBe(newLocation.id);
    expect(persistedOrg?.parentId).toBe(destination.id);
    expect(persistedOldLocation?.isActive).toBe(false);
  });

  it("attributes organization deactivation and its event cascades", async () => {
    const { ao, input } = await fixture();
    const event = await createSeries(input);
    await createTestClient().org.crupdate({
      id: ao.id,
      name: ao.name,
      orgType: "ao",
      isActive: false,
      email: null,
      phone: null,
      description: null,
      website: null,
      twitter: null,
      facebook: null,
      instagram: null,
    });
    await expectInactiveCascade(ao.id, event.id);
  });

  it("attributes organization deletion and its event cascades", async () => {
    const { ao, input } = await fixture();
    const event = await createSeries(input);
    vi.mocked(notifyWebhooks).mockClear();
    expect(await createTestClient().org.delete({ id: ao.id })).toEqual({
      orgId: ao.id,
    });
    expect(notifyWebhooks).toHaveBeenCalledTimes(1);
    await expectInactiveCascade(ao.id, event.id);
  });

  it("rolls back event deletion and history when its cascade fails", async () => {
    const { input } = await fixture();
    const event = await createSeries(input);
    vi.mocked(notifyWebhooks).mockClear();
    vi.spyOn(
      cascadeService,
      "softDeleteFutureInstancesForSeries",
    ).mockRejectedValueOnce(
      new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Synthetic cascade failure",
      }),
    );
    await expect(
      createTestClient().event.delete({ id: event.id }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(await history("events", "id", event.id, "U")).toEqual([]);
    const [persisted] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(persisted?.isActive).toBe(true);
    expect(notifyWebhooks).not.toHaveBeenCalled();
  });

  it("rolls back organization deletion and prior cascade writes on failure", async () => {
    const { ao, input } = await fixture();
    const event = await createSeries(input);
    vi.mocked(notifyWebhooks).mockClear();
    vi.spyOn(
      cascadeService,
      "softDeleteFutureInstancesForOrg",
    ).mockRejectedValueOnce(
      new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Synthetic cascade failure",
      }),
    );
    await expect(
      createTestClient().org.delete({ id: ao.id }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(await history("orgs", "id", ao.id, "U")).toEqual([]);
    expect(await history("events", "id", event.id, "U")).toEqual([]);
    const [persisted] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, ao.id));
    expect(persisted?.isActive).toBe(true);
    expect(notifyWebhooks).not.toHaveBeenCalled();
  });

  it("sends region email after commit and leaves notification bookkeeping unattributed", async () => {
    const { region, input } = await fixture();
    await db
      .update(schema.orgs)
      .set({ email: "audit-region@example.com" })
      .where(eq(schema.orgs.id, region.id));
    let committedActor: unknown;
    vi.spyOn(mail, "sendTemplateMessages").mockImplementationOnce(async () => {
      const rows = await db.execute(sql`
        SELECT changed_by FROM public_history.events
        WHERE new_row->>'name' = ${input.name} AND op = 'I'
      `);
      committedActor = rows[0]?.changed_by;
      return [];
    });
    await createSeries(input);
    expect(committedActor).toBe(1);
    const claims = (await history("orgs", "id", region.id, "U")).filter(
      (row) =>
        (row.new_row?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent === true,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ changed_by: null, changed_via: null });
  });
});
