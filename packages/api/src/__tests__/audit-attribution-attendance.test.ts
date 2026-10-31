import { and, eq, schema, sql } from "@acme/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "./test-utils";

describe("attendance audit attribution", () => {
  const eventInstanceIds: number[] = [];
  const userIds: number[] = [];
  const orgIds: number[] = [];
  let orgId: number;
  let targetUserId: number;
  let otherUserId: number;
  let coQUserId: number;
  let paxTypeId: number;
  let qTypeId: number;
  let coQTypeId: number;

  beforeAll(async () => {
    const nation = await getOrCreateF3NationOrg();
    const [org] = await db
      .insert(schema.orgs)
      .values({
        name: `Attendance audit ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id });
    if (!org) throw new Error("Missing synthetic organization");
    orgId = org.id;
    orgIds.push(orgId);

    for (let index = 0; index < 3; index++) {
      const [user] = await db
        .insert(schema.users)
        .values({ email: `attendance-audit-${uniqueId()}@example.com` })
        .returning({ id: schema.users.id });
      if (!user) throw new Error("Missing synthetic user");
      userIds.push(user.id);
    }
    [targetUserId, otherUserId, coQUserId] = userIds as [
      number,
      number,
      number,
    ];

    const typeIds: number[] = [];
    for (const type of ["PAX", "Q", "Co-Q"]) {
      let [row] = await db
        .select({ id: schema.attendanceTypes.id })
        .from(schema.attendanceTypes)
        .where(eq(schema.attendanceTypes.type, type));
      if (!row) {
        [row] = await db
          .insert(schema.attendanceTypes)
          .values({ type })
          .returning({ id: schema.attendanceTypes.id });
      }
      if (!row) throw new Error("Missing attendance type");
      typeIds.push(row.id);
    }
    [paxTypeId, qTypeId, coQTypeId] = typeIds as [number, number, number];
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await mockAuthWithSession(await createAdminSession());
  });

  afterAll(async () => {
    for (const id of eventInstanceIds.reverse()) {
      await db
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, id));
    }
    for (const id of userIds.reverse()) await cleanup.user(id);
    for (const id of orgIds.reverse()) await cleanup.org(id);
  });

  const createEventInstance = async () => {
    const [instance] = await db
      .insert(schema.eventInstances)
      .values({
        name: `Attendance audit ${uniqueId()}`,
        orgId,
        startDate: "2026-11-01",
        isActive: true,
        highlight: false,
      })
      .returning({ id: schema.eventInstances.id });
    if (!instance) throw new Error("Missing synthetic event instance");
    eventInstanceIds.push(instance.id);
    return instance.id;
  };

  const seedAttendance = async (
    eventInstanceId: number,
    userId: number,
    attendanceTypeIds: number[],
    isPlanned = true,
  ) => {
    const [attendance] = await db
      .insert(schema.attendance)
      .values({ eventInstanceId, userId, isPlanned })
      .returning({ id: schema.attendance.id });
    if (!attendance) throw new Error("Missing synthetic attendance");
    if (attendanceTypeIds.length) {
      await db.insert(schema.attendanceXAttendanceTypes).values(
        attendanceTypeIds.map((attendanceTypeId) => ({
          attendanceId: attendance.id,
          attendanceTypeId,
        })),
      );
    }
    return attendance.id;
  };

  const attendanceHistory = (attendanceId: number) =>
    db.execute(sql`
      SELECT op, changed_by, changed_via,
        (COALESCE(new_row, old_row)->>'user_id')::integer AS user_id
      FROM public_history.attendance
      WHERE row_id = ${String(attendanceId)} ORDER BY id
    `);

  const typeHistory = (attendanceId: number) =>
    db.execute(sql`
      SELECT op, changed_by, changed_via,
        (COALESCE(new_row, old_row)->>'attendance_type_id')::integer AS type_id
      FROM public_history.attendance_x_attendance_types
      WHERE COALESCE(new_row, old_row)->>'attendance_id' = ${String(attendanceId)}
      ORDER BY id
    `);

  it.each(["createPlanned", "createActual"] as const)(
    "%s attributes new attendance and replaced type links to the editor, not the attendee",
    async (procedure) => {
      const eventInstanceId = await createEventInstance();
      const client = createTestClient();
      const result = await client.attendance[procedure]({
        eventInstanceId,
        userId: targetUserId,
        attendanceTypeIds: [paxTypeId],
      });
      expect(result.success).toBe(true);
      expect(result.attendanceId).toBeTypeOf("number");
      expect(Object.keys(result).sort()).toEqual(["attendanceId", "success"]);
      expect(targetUserId).not.toBe(1);
      expect(await attendanceHistory(result.attendanceId)).toEqual([
        { op: "I", changed_by: 1, changed_via: null, user_id: targetUserId },
      ]);

      expect(
        await client.attendance[procedure]({
          eventInstanceId,
          userId: targetUserId,
          attendanceTypeIds: [qTypeId],
        }),
      ).toEqual(result);
      expect(await typeHistory(result.attendanceId)).toEqual([
        { op: "I", changed_by: 1, changed_via: null, type_id: paxTypeId },
        { op: "D", changed_by: 1, changed_via: null, type_id: paxTypeId },
        { op: "I", changed_by: 1, changed_via: null, type_id: qTypeId },
      ]);
      expect(
        await db
          .select()
          .from(schema.attendance)
          .where(eq(schema.attendance.id, result.attendanceId)),
      ).toMatchObject([
        { userId: targetUserId, isPlanned: procedure === "createPlanned" },
      ]);
    },
  );

  it("attributes deleting actual attendance and its type links while retaining planned attendance", async () => {
    const eventInstanceId = await createEventInstance();
    const actualId = await seedAttendance(
      eventInstanceId,
      targetUserId,
      [paxTypeId],
      false,
    );
    const plannedId = await seedAttendance(eventInstanceId, targetUserId, [
      qTypeId,
    ]);

    expect(
      await createTestClient().attendance.deleteActualForEvent({
        eventInstanceId,
      }),
    ).toEqual({
      success: true,
      deletedCount: 1,
    });
    expect((await attendanceHistory(actualId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, user_id: targetUserId },
    ]);
    expect((await typeHistory(actualId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, type_id: paxTypeId },
    ]);
    expect(
      await db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, eventInstanceId)),
    ).toEqual([{ id: plannedId }]);
  });

  it("attributes removing planned attendance and the cascading type deletion", async () => {
    const eventInstanceId = await createEventInstance();
    const attendanceId = await seedAttendance(eventInstanceId, targetUserId, [
      paxTypeId,
    ]);

    expect(
      await createTestClient().attendance.removePlanned({
        eventInstanceId,
        userId: targetUserId,
      }),
    ).toEqual({
      success: true,
      deletedCount: 1,
    });
    expect((await attendanceHistory(attendanceId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, user_id: targetUserId },
    ]);
    expect((await typeHistory(attendanceId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, type_id: paxTypeId },
    ]);
  });

  it("attributes both halves of replacing attendance types", async () => {
    const eventInstanceId = await createEventInstance();
    const attendanceId = await seedAttendance(eventInstanceId, targetUserId, [
      paxTypeId,
    ]);

    expect(
      await createTestClient().attendance.updateAttendanceTypes({
        attendanceId,
        attendanceTypeIds: [coQTypeId],
      }),
    ).toEqual({ success: true });
    expect((await typeHistory(attendanceId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, type_id: paxTypeId },
      { op: "I", changed_by: 1, changed_via: null, type_id: coQTypeId },
    ]);
  });

  it.each([false, true])(
    "attributes taking Q with existing attendance = %s",
    async (existing) => {
      const eventInstanceId = await createEventInstance();
      if (existing)
        await seedAttendance(eventInstanceId, targetUserId, [paxTypeId]);

      const result = await createTestClient().attendance.takeQ({
        eventInstanceId,
        userId: targetUserId,
      });
      expect(result.success).toBe(true);
      expect(result.attendanceId).toBeTypeOf("number");
      expect(Object.keys(result).sort()).toEqual(["attendanceId", "success"]);
      expect(await attendanceHistory(result.attendanceId)).toEqual([
        {
          op: "I",
          changed_by: existing ? null : 1,
          changed_via: null,
          user_id: targetUserId,
        },
      ]);
      const history = await typeHistory(result.attendanceId);
      expect(existing ? history.slice(1) : history).toEqual(
        existing
          ? [{ op: "I", changed_by: 1, changed_via: null, type_id: qTypeId }]
          : [
              { op: "I", changed_by: 1, changed_via: null, type_id: qTypeId },
              { op: "I", changed_by: 1, changed_via: null, type_id: paxTypeId },
            ],
      );
    },
  );

  it("attributes removing Q and Co-Q links while keeping PAX", async () => {
    const eventInstanceId = await createEventInstance();
    const attendanceId = await seedAttendance(eventInstanceId, targetUserId, [
      paxTypeId,
      qTypeId,
      coQTypeId,
    ]);

    expect(
      await createTestClient().attendance.removeQ({
        eventInstanceId,
        userId: targetUserId,
      }),
    ).toEqual({ success: true });
    const deletedTypes = (await typeHistory(attendanceId)).slice(3);
    expect(deletedTypes).toHaveLength(2);
    expect(deletedTypes).toEqual(
      expect.arrayContaining([
        { op: "D", changed_by: 1, changed_via: null, type_id: qTypeId },
        { op: "D", changed_by: 1, changed_via: null, type_id: coQTypeId },
      ]),
    );
    expect(
      await db
        .select({ typeId: schema.attendanceXAttendanceTypes.attendanceTypeId })
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
        ),
    ).toEqual([{ typeId: paxTypeId }]);
  });

  it("attributes assigning leaders, creating attendance, and demoting the prior leader", async () => {
    const eventInstanceId = await createEventInstance();
    const oldQId = await seedAttendance(eventInstanceId, targetUserId, [
      qTypeId,
    ]);
    const nextQId = await seedAttendance(eventInstanceId, otherUserId, [
      paxTypeId,
    ]);

    expect(
      await createTestClient().attendance.assignQAndCoQs({
        eventInstanceId,
        qUserId: otherUserId,
        coQUserIds: [coQUserId],
      }),
    ).toEqual({ success: true });
    expect((await typeHistory(oldQId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, type_id: qTypeId },
      { op: "I", changed_by: 1, changed_via: null, type_id: paxTypeId },
    ]);
    expect((await typeHistory(nextQId)).slice(1)).toEqual([
      { op: "D", changed_by: 1, changed_via: null, type_id: paxTypeId },
      { op: "I", changed_by: 1, changed_via: null, type_id: qTypeId },
    ]);
    const [coQ] = await db
      .select({ id: schema.attendance.id })
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.eventInstanceId, eventInstanceId),
          eq(schema.attendance.userId, coQUserId),
        ),
      );
    if (!coQ) throw new Error("Missing assigned Co-Q attendance");
    expect(await attendanceHistory(coQ.id)).toEqual([
      { op: "I", changed_by: 1, changed_via: null, user_id: coQUserId },
    ]);
    expect(await typeHistory(coQ.id)).toEqual([
      { op: "I", changed_by: 1, changed_via: null, type_id: coQTypeId },
    ]);
  });

  it("rolls back attendance and history when a new type link fails", async () => {
    const eventInstanceId = await createEventInstance();
    await expect(
      createTestClient().attendance.createPlanned({
        eventInstanceId,
        userId: targetUserId,
        attendanceTypeIds: [2147483647],
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    expect(
      await db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(eq(schema.attendance.eventInstanceId, eventInstanceId)),
    ).toEqual([]);
    expect(
      await db.execute(sql`
      SELECT op FROM public_history.attendance
      WHERE new_row->>'event_instance_id' = ${String(eventInstanceId)}
    `),
    ).toEqual([]);
  });

  it("rolls back deleted type links and history when replacement fails", async () => {
    const eventInstanceId = await createEventInstance();
    const attendanceId = await seedAttendance(eventInstanceId, targetUserId, [
      paxTypeId,
    ]);
    await expect(
      createTestClient().attendance.updateAttendanceTypes({
        attendanceId,
        attendanceTypeIds: [2147483647],
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    expect(
      await db
        .select({ typeId: schema.attendanceXAttendanceTypes.attendanceTypeId })
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
        ),
    ).toEqual([{ typeId: paxTypeId }]);
    expect(await typeHistory(attendanceId)).toEqual([
      { op: "I", changed_by: null, changed_via: null, type_id: paxTypeId },
    ]);
  });
});
