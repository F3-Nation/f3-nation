/**
 * Tests for the legacy edit-request conversion helpers.
 *
 * The pure classification/meta tests run anywhere. The `applySplit` suite is
 * DB-backed and requires:
 *   - TEST_DATABASE_URL to be set
 *   - the test database migrated + seeded: `pnpm -C packages/db reset-test-db`
 *     (provides the seeded region org the fixture event/request reference)
 *
 * Run with: pnpm -C packages/db test
 */
import { TEST_REGION_1_ORG_ID } from "@acme/shared/app/constants";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, schema } from ".";
import { db } from "./client";
import type { LegacyRow } from "./convert-legacy-edit-requests";
import {
  applyConversion,
  applySplit,
  buildMeta,
  classify,
} from "./convert-legacy-edit-requests";

const base: LegacyRow = {
  id: "00000000-0000-0000-0000-000000000000",
  event_id: null,
  ao_id: null,
  location_id: null,
  region_id: null,
  meta: null,
};

describe("classify", () => {
  it("returns 'both' when an event and an ao/location target are set", () => {
    expect(classify({ ...base, event_id: 1, ao_id: 2 })).toBe("both");
    expect(classify({ ...base, event_id: 1, location_id: 3 })).toBe("both");
  });

  it("returns 'edit_event' when only an event target is set", () => {
    expect(classify({ ...base, event_id: 1 })).toBe("edit_event");
  });

  it("returns 'edit_ao_and_location' when only ao/location is set", () => {
    expect(classify({ ...base, ao_id: 2 })).toBe("edit_ao_and_location");
    expect(classify({ ...base, location_id: 3 })).toBe("edit_ao_and_location");
  });

  it("returns 'unclassifiable' when no target ids are set", () => {
    expect(classify(base)).toBe("unclassifiable");
  });

  it("treats 0 as a present id (not null)", () => {
    // ids are `!= null` checks, so a legitimate 0 must not read as absent
    expect(classify({ ...base, event_id: 0 })).toBe("edit_event");
    expect(classify({ ...base, ao_id: 0 })).toBe("edit_ao_and_location");
  });
});

describe("buildMeta", () => {
  const now = "2026-07-17T00:00:00.000Z";

  it("backfills original* ids from the row's columns", () => {
    expect(
      buildMeta(
        {
          ...base,
          event_id: 11,
          ao_id: 22,
          location_id: 33,
          region_id: 44,
        },
        now,
      ),
    ).toEqual({
      originalEventId: 11,
      originalAoId: 22,
      originalLocationId: 33,
      originalRegionId: 44,
      convertedFrom: "edit",
      convertedAt: now,
    });
  });

  it("omits original* ids that are null", () => {
    const meta = buildMeta({ ...base, event_id: 11 }, now);
    expect(meta).toEqual({
      originalEventId: 11,
      convertedFrom: "edit",
      convertedAt: now,
    });
    expect(meta).not.toHaveProperty("originalAoId");
    expect(meta).not.toHaveProperty("originalLocationId");
  });

  it("preserves existing meta and stamps the conversion marker", () => {
    const meta = buildMeta(
      { ...base, event_id: 11, meta: { source: "legacy", keep: true } },
      now,
    );
    expect(meta).toMatchObject({
      source: "legacy",
      keep: true,
      originalEventId: 11,
      convertedFrom: "edit",
      convertedAt: now,
    });
  });
});

describe("applySplit (DB-backed)", () => {
  const now = "2026-07-17T00:00:00.000Z";
  const createdIds: string[] = [];
  let eventId: number;

  beforeAll(async () => {
    const [event] = await db
      .insert(schema.events)
      .values({
        orgId: TEST_REGION_1_ORG_ID,
        isActive: true,
        highlight: false,
        startDate: "2026-01-01",
        name: "Split fixture event",
      })
      .returning({ id: schema.events.id });
    eventId = event!.id;
  });

  afterEach(async () => {
    if (createdIds.length) {
      await db
        .delete(schema.updateRequests)
        .where(inArray(schema.updateRequests.id, createdIds));
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
  });

  it("splits a 'both' row into a linked ao/location + event pair in one tx", async () => {
    const [inserted] = await db
      .insert(schema.updateRequests)
      .values({
        regionId: TEST_REGION_1_ORG_ID,
        eventId,
        aoId: 999,
        submittedBy: "split-test@example.com",
        requestType: "edit",
        status: "pending",
        eventName: "Legacy event name",
        eventDescription: "Legacy description",
        eventStartTime: "05:30",
        eventEndTime: "06:15",
        eventTypeIds: [1, 2],
        meta: { source: "legacy" },
      })
      .returning({
        id: schema.updateRequests.id,
        created: schema.updateRequests.created,
      });
    const originalId = inserted!.id;
    createdIds.push(originalId);

    const row: LegacyRow = {
      id: originalId,
      event_id: eventId,
      ao_id: 999,
      location_id: null,
      region_id: TEST_REGION_1_ORG_ID,
      meta: { source: "legacy" },
    };

    const newId = await applySplit(row, buildMeta(row, now));
    createdIds.push(newId);

    // Original row is now the ao/location edit, linked to its sibling.
    const original = await db.query.updateRequests.findFirst({
      where: eq(schema.updateRequests.id, originalId),
    });
    expect(original?.requestType).toBe("edit_ao_and_location");
    expect(original?.meta).toMatchObject({
      source: "legacy",
      originalEventId: eventId,
      originalAoId: 999,
      convertedFrom: "edit",
      convertedAt: now,
      splitSiblingId: newId,
    });

    // New row carries the event edit and links back to the original.
    const sibling = await db.query.updateRequests.findFirst({
      where: eq(schema.updateRequests.id, newId),
    });
    expect(sibling?.requestType).toBe("edit_event");
    expect(sibling?.meta).toMatchObject({
      splitFromId: originalId,
      convertedFrom: "edit",
      convertedAt: now,
    });

    // The INSERT ... SELECT copies every carried column onto the sibling.
    expect(sibling?.regionId).toBe(TEST_REGION_1_ORG_ID);
    expect(sibling?.eventId).toBe(eventId);
    expect(sibling?.aoId).toBe(999);
    expect(sibling?.eventName).toBe("Legacy event name");
    expect(sibling?.eventDescription).toBe("Legacy description");
    expect(sibling?.eventStartTime).toBe("05:30");
    expect(sibling?.eventEndTime).toBe("06:15");
    expect(sibling?.eventTypeIds).toEqual([1, 2]);
    expect(sibling?.submittedBy).toBe("split-test@example.com");
    expect(sibling?.status).toBe("pending");
    expect(sibling?.created).toBe(inserted!.created);
  });
});

describe("applyConversion (DB-backed)", () => {
  const createdIds: string[] = [];

  const insertLegacyRow = async (
    status: "pending" | "approved",
  ): Promise<string> => {
    const [inserted] = await db
      .insert(schema.updateRequests)
      .values({
        regionId: TEST_REGION_1_ORG_ID,
        aoId: 999,
        submittedBy: "convert-test@example.com",
        requestType: "edit",
        status,
        meta: { source: "legacy" },
      })
      .returning({ id: schema.updateRequests.id });
    createdIds.push(inserted!.id);
    return inserted!.id;
  };

  afterEach(async () => {
    if (createdIds.length) {
      await db
        .delete(schema.updateRequests)
        .where(inArray(schema.updateRequests.id, createdIds));
      createdIds.length = 0;
    }
  });

  it("reclassifies a pending legacy 'edit' row in place", async () => {
    const id = await insertLegacyRow("pending");
    const row: LegacyRow = {
      id,
      event_id: null,
      ao_id: 999,
      location_id: null,
      region_id: TEST_REGION_1_ORG_ID,
      meta: { source: "legacy" },
    };

    await applyConversion(row, "edit_ao_and_location");

    const updated = await db.query.updateRequests.findFirst({
      where: eq(schema.updateRequests.id, id),
    });
    expect(updated?.requestType).toBe("edit_ao_and_location");
    expect(updated?.meta).toMatchObject({
      source: "legacy",
      originalAoId: 999,
      convertedFrom: "edit",
    });
  });

  it("leaves a row untouched when it is no longer pending 'edit'", async () => {
    // The WHERE guard (status='pending' AND request_type='edit') must protect a
    // row a reviewer has already acted on between the SELECT and the UPDATE.
    const id = await insertLegacyRow("approved");
    const row: LegacyRow = {
      id,
      event_id: null,
      ao_id: 999,
      location_id: null,
      region_id: TEST_REGION_1_ORG_ID,
      meta: { source: "legacy" },
    };

    await applyConversion(row, "edit_ao_and_location");

    const untouched = await db.query.updateRequests.findFirst({
      where: eq(schema.updateRequests.id, id),
    });
    expect(untouched?.requestType).toBe("edit");
    expect(untouched?.meta).toEqual({ source: "legacy" });
  });
});
