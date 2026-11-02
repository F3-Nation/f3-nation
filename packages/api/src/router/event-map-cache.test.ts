import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq, schema, sql } from "@acme/db";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import { cachedMapData, clearMapDataCache } from "../lib/map-data-cache";
import { notifyWebhooks } from "../lib/notify-webhooks";
import { waitForEventRegionNotificationTasks } from "./event";

// Keep cache invalidation real while replacing external HTTP delivery.
vi.unmock("../lib/revalidate-map");
vi.mock("@acme/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acme/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_MAP_URL: "https://map.example.test",
      SUPER_ADMIN_API_KEY: "synthetic-map-key",
    },
  };
});
vi.mock("../lib/first-event-service", () => ({
  maybeNotifyFirstEventForRegion: vi.fn().mockResolvedValue(undefined),
  maybeNotifyRegionInABox: vi.fn().mockResolvedValue(undefined),
}));

const client = createTestClient();
let adminSession: Awaited<ReturnType<typeof createAdminSession>>;
const readMap = async () => {
  await mockAuthWithSession(null);
  try {
    return await client.map.location.eventsAndLocations();
  } finally {
    await mockAuthWithSession(adminSession);
  }
};
const eventIds: number[] = [];
const orgIds: number[] = [];
const locationIds: number[] = [];
const typeIds: number[] = [];

const fixture = async () => {
  const nation = await getOrCreateF3NationOrg();
  const [region] = await db
    .insert(schema.orgs)
    .values({
      name: `Cache region ${uniqueId()}`,
      orgType: "region",
      parentId: nation.id,
      isActive: true,
    })
    .returning();
  orgIds.push(region!.id);
  const [ao] = await db
    .insert(schema.orgs)
    .values({
      name: `Cache AO ${uniqueId()}`,
      orgType: "ao",
      parentId: region!.id,
      isActive: true,
    })
    .returning();
  orgIds.push(ao!.id);
  const [location] = await db
    .insert(schema.locations)
    .values({
      name: `Cache location ${uniqueId()}`,
      orgId: region!.id,
      isActive: true,
      latitude: 35.5,
      longitude: -80.5,
    })
    .returning();
  locationIds.push(location!.id);
  const [eventType] = await db
    .insert(schema.eventTypes)
    .values({
      name: `Cache type ${uniqueId()}`,
      eventCategory: "first_f",
      isActive: true,
    })
    .returning();
  typeIds.push(eventType!.id);
  const dateResult = await db.execute<{ today: string }>(
    sql`select CURRENT_DATE::text as today`,
  );
  return {
    name: `Cache workout ${uniqueId()}`,
    aoId: ao!.id,
    regionId: region!.id,
    locationId: location!.id,
    dayOfWeek: null,
    startTime: "0530",
    endTime: "0615",
    startDate: dateResult[0]!.today,
    endDate: null,
    isActive: true,
    isPrivate: false,
    highlight: false,
    eventTypeIds: [eventType!.id],
    email: null,
    recurrencePattern: null,
    recurrenceInterval: null,
    indexWithinInterval: null,
  };
};

const seedEvent = async (
  input: Awaited<ReturnType<typeof fixture>>,
  weekday: "monday" | null = null,
) => {
  const [event] = await db
    .insert(schema.events)
    .values({
      name: input.name,
      orgId: input.aoId,
      locationId: input.locationId,
      dayOfWeek: weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      startDate: input.startDate,
      endDate: null,
      isActive: true,
      isPrivate: false,
      highlight: false,
      recurrencePattern: weekday ? "weekly" : null,
      recurrenceInterval: weekday ? 1 : null,
    })
    .returning();
  eventIds.push(event!.id);
  return event!;
};

const publicEvent = async (id: number) => {
  const rows = await readMap();
  return rows.flatMap((row) => row[6]).find((event) => event[0] === id);
};

beforeEach(async () => {
  clearMapDataCache();
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response("", { status: 200 })),
  );
  adminSession = await createAdminSession();
  await mockAuthWithSession(adminSession);
});

afterEach(async () => {
  await waitForEventRegionNotificationTasks();
  clearMapDataCache();
  vi.restoreAllMocks();
  for (const id of eventIds.splice(0).reverse()) await cleanup.event(id);
  for (const id of typeIds.splice(0).reverse()) await cleanup.eventType(id);
  for (const id of locationIds.splice(0).reverse()) await cleanup.location(id);
  for (const id of orgIds.splice(0).reverse()) await cleanup.org(id);
});

describe("event mutation map cache", () => {
  it("includes a newly created one-off event without waiting for cache expiry", async () => {
    const input = await fixture();
    const before = await readMap();
    expect(before.some((row) => row[0] === input.locationId)).toBe(false);
    const { event } = await client.event.crupdate(input);
    assert(event !== null);
    eventIds.push(event.id);
    expect(await publicEvent(event.id)).toEqual(
      expect.arrayContaining([event.id, input.name]),
    );
    expect(notifyWebhooks).toHaveBeenCalledExactlyOnceWith({
      action: "map.created",
      eventId: event.id,
    });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://map.example.test/api/revalidate",
      { method: "POST", headers: { "x-api-key": "synthetic-map-key" } },
    );
  });

  it.each([
    { name: "deactivation", patch: { isActive: false } },
    { name: "private visibility", patch: { isPrivate: true } },
  ])("removes a one-off event after $name", async ({ patch }) => {
    const input = await fixture();
    const event = await seedEvent(input);
    expect((await publicEvent(event.id))?.[1]).toBe(input.name);
    await client.event.crupdate({ ...input, id: event.id, ...patch });
    const [saved] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(saved).toMatchObject(patch);
    expect(await publicEvent(event.id)).toBeUndefined();
    expect(notifyWebhooks).toHaveBeenCalledExactlyOnceWith({
      action: "map.updated",
      eventId: event.id,
    });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://map.example.test/api/revalidate",
      { method: "POST", headers: { "x-api-key": "synthetic-map-key" } },
    );
  });

  it("refreshes a one-off event's public name", async () => {
    const input = await fixture();
    const event = await seedEvent(input);
    expect((await publicEvent(event.id))?.[1]).toBe(input.name);
    await client.event.crupdate({
      ...input,
      id: event.id,
      name: "Updated workout",
    });
    expect((await publicEvent(event.id))?.[1]).toBe("Updated workout");
  });

  it("preserves the recurring schedule when conversion to a one-off is rejected", async () => {
    const input = await fixture();
    const event = await seedEvent(input, "monday");
    expect((await publicEvent(event.id))?.[2]).toBe("monday");
    await cachedMapData("rejected-write-probe", () =>
      Promise.resolve("retained"),
    );
    await expect(
      client.event.crupdate({ ...input, id: event.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [unchanged] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(unchanged).toEqual(event);
    expect((await publicEvent(event.id))?.[2]).toBe("monday");
    expect(
      await cachedMapData("rejected-write-probe", () =>
        Promise.resolve("cleared"),
      ),
    ).toBe("retained");
    expect(notifyWebhooks).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still invalidates a deactivated recurring event", async () => {
    const input = await fixture();
    const event = await seedEvent(input, "monday");
    expect((await publicEvent(event.id))?.[1]).toBe(input.name);
    await client.event.crupdate({
      ...input,
      id: event.id,
      dayOfWeek: "monday",
      recurrencePattern: "weekly",
      recurrenceInterval: 1,
      isActive: false,
    });
    expect(await publicEvent(event.id)).toBeUndefined();
  });

  it("still removes a deleted one-off event from the cached dataset", async () => {
    const input = await fixture();
    const event = await seedEvent(input);
    expect((await publicEvent(event.id))?.[1]).toBe(input.name);
    await client.event.delete({ id: event.id });
    expect(await publicEvent(event.id)).toBeUndefined();
    expect(notifyWebhooks).toHaveBeenCalledWith({
      action: "map.deleted",
      eventId: event.id,
    });
  });

  it.each([
    {
      name: "missing event type",
      invalidFields: { eventTypeIds: [2_147_483_647] },
      code: "NOT_FOUND",
      message: "Event type not found",
    },
    {
      name: "invalid event tags",
      invalidFields: { eventTagIds: [2_147_483_647] },
      code: "BAD_REQUEST",
      message: "Invalid event tags",
    },
  ])(
    "does not notify or invalidate cached data for $name",
    async ({ invalidFields, code, message }) => {
      const input = await fixture();
      const event = await seedEvent(input);
      const before = await readMap();
      await cachedMapData("rejected-write-probe", () =>
        Promise.resolve("retained"),
      );
      await expect(
        client.event.crupdate({
          ...input,
          id: event.id,
          name: "Rejected workout change",
          ...invalidFields,
        }),
      ).rejects.toMatchObject({ code, message });
      const [unchanged] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));
      expect(unchanged).toEqual(event);
      const after = await readMap();
      expect(after).toEqual(before);
      expect(
        await cachedMapData("rejected-write-probe", () =>
          Promise.resolve("cleared"),
        ),
      ).toBe("retained");
      expect(notifyWebhooks).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect((await publicEvent(event.id))?.[1]).toBe(input.name);
    },
  );
});
