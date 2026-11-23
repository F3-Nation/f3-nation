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

  // Looked up by name: test databases don't guarantee the ids 1, 2 and 3
  // that production uses.
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

  // xmin changes on every UPDATE of the row, including one that writes the
  // value it already holds, so an unchanged xmin means the row wasn't written.
  const rowVersion = async (attendanceId: number) => {
    const rows = await db.execute<{ v: string }>(sql`
      SELECT xmin::text AS v FROM attendance WHERE id = ${attendanceId}`);
    return must(rows[0]).v;
  };

  // Resolves once the given backend is waiting on a lock, so a test knows a
  // concurrent statement reached the server and blocked before it releases
  // that lock. Fails if the statement finishes first.
  const waitUntilBlocked = async (pid: number, pending: Promise<unknown>) => {
    const state = { settled: false };
    void pending.then(
      () => (state.settled = true),
      () => (state.settled = true),
    );
    const deadline = Date.now() + 5_000;
    for (;;) {
      if (state.settled) {
        throw new Error("Expected the statement to wait on a lock");
      }
      const rows = await db.execute<{ waiting: boolean }>(sql`
        SELECT wait_event_type = 'Lock' AS waiting
        FROM pg_stat_activity WHERE pid = ${pid}`);
      if (rows[0]?.waiting) return;
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the statement to block");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  // Two single-connection clients, for tests that hold a lock in one while
  // the other waits on it.
  const openClients = async () => {
    const { default: postgres } = await import("postgres");
    const { env } = await import("@acme/env");
    const url = must(env.TEST_DATABASE_URL);
    const first = postgres(url, { max: 1, prepare: false });
    const second = postgres(url, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    const [row] = await second<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    return { first, second, secondPid: must(row).pid };
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
    const before = await rowVersion(bystander);

    await link(changed, "Q");
    await unlink(changed, "Q");

    expect(await typeOf(bystander)).toBe("co_q");
    expect(await rowVersion(bystander)).toBe(before);
  });

  it("does not write the record when the type does not change", async () => {
    const id = await newAttendance();
    await link(id, "Q");
    const before = await rowVersion(id);

    await link(id, "PAX");
    await unlink(id, "PAX");

    expect(await typeOf(id)).toBe("q");
    expect(await rowVersion(id)).toBe(before);
  });

  it("ends correct when two transactions change one record's link rows at once", async () => {
    const id = await newAttendance();
    await link(id, "Q");
    const { first, second, secondPid } = await openClients();
    try {
      // The first transaction removes Q and stays open. The second adds Co-Q
      // while the first's change is still invisible to it; it must wait for
      // the first to commit rather than keep the `q` it would compute alone.
      await first`BEGIN`;
      await first`
        DELETE FROM attendance_x_attendance_types
        WHERE attendance_id = ${id} AND attendance_type_id = ${typeIds.Q}`;
      const insert = second`
        INSERT INTO attendance_x_attendance_types (attendance_id, attendance_type_id)
        VALUES (${id}, ${typeIds["Co-Q"]})`.execute();
      await waitUntilBlocked(secondPid, insert);
      await first`COMMIT`;
      await insert;
    } finally {
      await first.end();
      await second.end();
    }

    expect(await typeOf(id)).toBe("co_q");
  });

  // SECURITY DEFINER lets a login that may write link rows, but not update
  // attendance, keep working.
  it("syncs a link row written by a role that can't update attendance", async () => {
    const id = await newAttendance();
    const rollback = new Error("rollback");
    let typeSeen: string | undefined;
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`CREATE ROLE attendance_link_writer NOLOGIN`);
        await tx.execute(
          sql`GRANT USAGE ON SCHEMA public TO attendance_link_writer`,
        );
        await tx.execute(
          sql`GRANT INSERT ON attendance_x_attendance_types TO attendance_link_writer`,
        );
        await tx.execute(sql`SET LOCAL ROLE attendance_link_writer`);
        await tx.execute(sql`
          INSERT INTO attendance_x_attendance_types (attendance_id, attendance_type_id)
          VALUES (${id}, ${typeIds.Q})`);
        await tx.execute(sql`RESET ROLE`);
        const rows = await tx.execute<{ t: string }>(sql`
          SELECT attendance_type::text AS t FROM attendance WHERE id = ${id}`);
        typeSeen = rows[0]?.t;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(typeSeen).toBe("q");
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
      const before = await rowVersion(id);

      await db.execute(sql`CALL public.backfill_attendance_type()`);

      expect(await typeOf(id)).toBe("q");
      expect(await rowVersion(id)).toBe(before);
    });

    // Drizzle wraps the Postgres error, whose message is on `cause`.
    const pgErrorText = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        const err = error as Error & { cause?: { message?: string } };
        return `${err.message} ${err.cause?.message ?? ""}`;
      }
      throw new Error("Expected the call to fail");
    };

    it.each(["0", "-1", "NULL"])("rejects batch_size %s", async (size) => {
      expect(
        await pgErrorText(() =>
          db.execute(sql.raw(`CALL public.backfill_attendance_type(${size})`)),
        ),
      ).toMatch(/batch_size must be a positive integer/);
    });

    // The exception is raised before the procedure's first COMMIT, so it can
    // run inside a transaction block, whose rollback restores the name.
    it("stops when no type is named Co-Q", async () => {
      expect(
        await pgErrorText(() =>
          db.transaction(async (tx) => {
            await tx.execute(sql`
              UPDATE attendance_types SET type = 'Co-Q-renamed'
              WHERE id = ${typeIds["Co-Q"]}`);
            await tx.execute(sql`CALL public.backfill_attendance_type()`);
          }),
        ),
      ).toMatch(/attendance_types needs rows named Q and Co-Q/);
    });

    it("reaches a record at the highest integer id without overflowing", async () => {
      // A fresh record supplies a user; the copy at maxId is not planned, so
      // it doesn't collide with it.
      await newAttendance();
      const maxId = 2147483647;
      await db.insert(schema.attendance).values({
        id: maxId,
        userId: must(createdUserIds.at(-1)),
        eventInstanceId,
        isPlanned: false,
      });
      try {
        await link(maxId, "Q");
        await forceType([maxId], "pax");

        // Two batches: the second ends past the integer limit.
        await db.execute(sql`CALL public.backfill_attendance_type(1073741824)`);

        expect(await typeOf(maxId)).toBe("q");
      } finally {
        await db
          .delete(schema.attendance)
          .where(eq(schema.attendance.id, maxId));
      }
    });

    it("does not restore a leadership type removed while it runs", async () => {
      const id = await newAttendance();
      await link(id, "Q");
      await forceType([id], "pax");
      const { first, second, secondPid } = await openClients();
      try {
        // The first transaction removes Q and holds the record's lock. Its
        // trigger skips the write because the record is already pax. The
        // backfill still sees the uncommitted link row and must not write q
        // once the removal commits.
        await first`BEGIN`;
        await first`
          DELETE FROM attendance_x_attendance_types
          WHERE attendance_id = ${id} AND attendance_type_id = ${typeIds.Q}`;
        const backfill =
          second`CALL public.backfill_attendance_type()`.execute();
        await waitUntilBlocked(secondPid, backfill);
        await first`COMMIT`;
        await backfill;
      } finally {
        await first.end();
        await second.end();
      }

      expect(await typeOf(id)).toBe("pax");
    });
  });
});
