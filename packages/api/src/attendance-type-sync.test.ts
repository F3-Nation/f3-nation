import { eq, inArray, schema, sql } from "@acme/db";
import type { AttendanceType } from "@acme/shared/app/enums";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanup,
  db,
  getOrCreateF3NationOrg,
  uniqueId,
} from "./__tests__/test-utils";

// attendance.attendance_type is derived from the attendance_x_attendance_types
// link rows by the sync_attendance_type trigger, with the precedence Q, then
// Co-Q, then PAX, and `pax` for a record with no link rows (ADR 0007).

type TypeName = "PAX" | "Q" | "Co-Q";

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Expected a value");
  return value;
};

describe("attendance_type sync from attendance_x_attendance_types", () => {
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];
  let eventInstanceId: number;
  const typeIds = {} as Record<TypeName, number>;

  // Matches the API's lookup by name: test databases don't guarantee the ids
  // 1, 2 and 3 that production uses.
  const getOrCreateType = async (type: TypeName) => {
    const [existing] = await db
      .select()
      .from(schema.attendanceTypes)
      .where(eq(schema.attendanceTypes.type, type));
    if (existing) return existing.id;
    const [created] = await db
      .insert(schema.attendanceTypes)
      .values({ type })
      .returning();
    return must(created).id;
  };

  beforeAll(async () => {
    for (const type of ["PAX", "Q", "Co-Q"] as const) {
      typeIds[type] = await getOrCreateType(type);
    }
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Sync Region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning();
    createdOrgIds.push(must(region).id);
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Sync AO ${uniqueId()}`,
        orgType: "ao",
        parentId: must(region).id,
        isActive: true,
      })
      .returning();
    createdOrgIds.push(must(ao).id);
    eventInstanceId = await newEventInstance();
  });

  afterAll(async () => {
    // Deleting the instances cascades to attendance and its link rows.
    await db
      .delete(schema.eventInstances)
      .where(inArray(schema.eventInstances.orgId, createdOrgIds));
    for (const userId of createdUserIds.reverse()) await cleanup.user(userId);
    for (const orgId of createdOrgIds.reverse()) await cleanup.org(orgId);
  }, 30_000);

  const newEventInstance = async () => {
    const [instance] = await db
      .insert(schema.eventInstances)
      .values({
        name: `Sync Event ${uniqueId()}`,
        orgId: must(createdOrgIds[1]),
        startDate: new Date().toISOString().split("T")[0]!,
        isActive: true,
        highlight: false,
      })
      .returning();
    return must(instance).id;
  };

  const newAttendance = async (instanceId = eventInstanceId) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `sync-${uniqueId()}@example.com`,
        f3Name: `Sync ${uniqueId()}`,
      })
      .returning();
    createdUserIds.push(must(user).id);
    const [record] = await db
      .insert(schema.attendance)
      .values({
        userId: must(user).id,
        eventInstanceId: instanceId,
        isPlanned: true,
      })
      .returning();
    return must(record).id;
  };

  // One statement per link row, in the order given, so a "last write wins"
  // implementation would fail the orderings below.
  const link = async (attendanceId: number, ...types: TypeName[]) => {
    for (const type of types) {
      await db
        .insert(schema.attendanceXAttendanceTypes)
        .values({ attendanceId, attendanceTypeId: typeIds[type] });
    }
  };

  const unlink = async (attendanceId: number, type: TypeName) => {
    await db.execute(sql`
      DELETE FROM attendance_x_attendance_types
      WHERE attendance_id = ${attendanceId}
        AND attendance_type_id = ${typeIds[type]}`);
  };

  const typeOf = async (attendanceId: number) => {
    const [row] = await db
      .select({ attendanceType: schema.attendance.attendanceType })
      .from(schema.attendance)
      .where(eq(schema.attendance.id, attendanceId));
    return must(row).attendanceType;
  };

  const historyCount = async (attendanceId: number) => {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM public_history.attendance
      WHERE row_id = ${String(attendanceId)} AND op = 'U'`);
    return Number(must(rows[0]).n);
  };

  it("is pax for a record with no link rows", async () => {
    expect(await typeOf(await newAttendance())).toBe("pax");
  });

  it.each<[TypeName[], AttendanceType]>([
    [["PAX"], "pax"],
    [["Q"], "q"],
    [["Co-Q"], "co_q"],
    [["PAX", "Q"], "q"],
    [["Q", "PAX"], "q"],
    [["PAX", "Co-Q"], "co_q"],
    [["Q", "Co-Q"], "q"],
    [["Co-Q", "Q"], "q"],
    [["PAX", "Q", "Co-Q"], "q"],
    [["Co-Q", "PAX", "Q"], "q"],
  ])("links %j give %s", async (types, expected) => {
    const id = await newAttendance();
    await link(id, ...types);
    expect(await typeOf(id)).toBe(expected);
  });

  it("falls back to the next type when a link row is deleted", async () => {
    const id = await newAttendance();
    await link(id, "PAX", "Q", "Co-Q");

    await unlink(id, "Q");
    expect(await typeOf(id)).toBe("co_q");

    await unlink(id, "Co-Q");
    expect(await typeOf(id)).toBe("pax");
  });

  it("returns to pax when the last link row is deleted", async () => {
    const id = await newAttendance();
    await link(id, "Q");

    await unlink(id, "Q");

    expect(await typeOf(id)).toBe("pax");
  });

  it("follows a link row whose type is replaced", async () => {
    const id = await newAttendance();
    await link(id, "PAX");

    await db.execute(sql`
      UPDATE attendance_x_attendance_types SET attendance_type_id = ${typeIds.Q}
      WHERE attendance_id = ${id}`);
    expect(await typeOf(id)).toBe("q");

    await db.execute(sql`
      UPDATE attendance_x_attendance_types SET attendance_type_id = ${typeIds["Co-Q"]}
      WHERE attendance_id = ${id}`);
    expect(await typeOf(id)).toBe("co_q");
  });

  it("recomputes both records when a link row moves to another record", async () => {
    const from = await newAttendance();
    const to = await newAttendance();
    await link(from, "Q");

    await db.execute(sql`
      UPDATE attendance_x_attendance_types SET attendance_id = ${to}
      WHERE attendance_id = ${from}`);

    expect(await typeOf(from)).toBe("pax");
    expect(await typeOf(to)).toBe("q");
  });

  it("leaves other records alone", async () => {
    const changed = await newAttendance();
    const bystander = await newAttendance();
    await link(bystander, "Co-Q");

    await link(changed, "Q");
    await unlink(changed, "Q");

    expect(await typeOf(bystander)).toBe("co_q");
  });

  it("writes no attendance history when the type does not change", async () => {
    const id = await newAttendance();
    await link(id, "Q");
    const before = await historyCount(id);

    await link(id, "PAX");
    await unlink(id, "PAX");

    expect(await typeOf(id)).toBe("q");
    expect(await historyCount(id)).toBe(before);
  });

  it("deletes an attendance record whose link rows cascade", async () => {
    const id = await newAttendance();
    await link(id, "PAX", "Q");

    await db.delete(schema.attendance).where(eq(schema.attendance.id, id));

    const links = await db
      .select()
      .from(schema.attendanceXAttendanceTypes)
      .where(eq(schema.attendanceXAttendanceTypes.attendanceId, id));
    expect(links).toEqual([]);
  });

  it("deletes an event instance whose attendance and link rows cascade", async () => {
    const instanceId = await newEventInstance();
    const id = await newAttendance(instanceId);
    await link(id, "Co-Q");

    await db
      .delete(schema.eventInstances)
      .where(eq(schema.eventInstances.id, instanceId));

    const rows = await db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.id, id));
    expect(rows).toEqual([]);
  });

  describe("backfill_attendance_type procedure", () => {
    // Sets the column without touching link rows, as on a database migrated
    // before the backfill has run.
    const forceType = async (ids: number[], value: AttendanceType) => {
      await db
        .update(schema.attendance)
        .set({ attendanceType: value })
        .where(inArray(schema.attendance.id, ids));
    };

    it("sets every leadership record from its link rows, across several batches", async () => {
      const q = await newAttendance();
      const coQ = await newAttendance();
      const paxQ = await newAttendance();
      const qCoQ = await newAttendance();
      const pax = await newAttendance();
      const none = await newAttendance();
      await link(q, "Q");
      await link(coQ, "Co-Q");
      await link(paxQ, "PAX", "Q");
      await link(qCoQ, "Co-Q", "Q");
      await link(pax, "PAX");
      await forceType([q, coQ, paxQ, qCoQ], "pax");

      await db.execute(sql`CALL public.backfill_attendance_type(2)`);

      expect({
        q: await typeOf(q),
        coQ: await typeOf(coQ),
        paxQ: await typeOf(paxQ),
        qCoQ: await typeOf(qCoQ),
        pax: await typeOf(pax),
        none: await typeOf(none),
      }).toEqual({
        q: "q",
        coQ: "co_q",
        paxQ: "q",
        qCoQ: "q",
        pax: "pax",
        none: "pax",
      });
    });

    it("leaves records that are already correct unwritten", async () => {
      const id = await newAttendance();
      await link(id, "Q");
      const before = await historyCount(id);

      await db.execute(sql`CALL public.backfill_attendance_type()`);

      expect(await typeOf(id)).toBe("q");
      expect(await historyCount(id)).toBe(before);
    });
  });
});
