/**
 * Tests for Attendance Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { and, eq, inArray, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createNoPermissionSession,
  createTestClient,
  createUserSession,
  db,
  ensureAttendanceTypes,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

/**
 * Store attendance type IDs fetched/created during setup
 */
let ATTENDANCE_TYPE_IDS: {
  PAX: number;
  Q: number;
  COQ: number;
} | null = null;

/**
 * Get or create required attendance types for testing
 */
const getOrCreateAttendanceTypes = async () => {
  ATTENDANCE_TYPE_IDS ??= await ensureAttendanceTypes();
  return ATTENDANCE_TYPE_IDS;
};

describe("Attendance Router", () => {
  // Track created resources for cleanup
  const createdEventInstanceIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdAttendanceIds: number[] = [];

  // Set up attendance types before all tests
  beforeAll(async () => {
    await getOrCreateAttendanceTypes();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset rate limiter to allow requests
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    // Clean up in reverse order respecting FK constraints
    for (const attendanceId of createdAttendanceIds.reverse()) {
      try {
        await db
          .delete(schema.attendanceXAttendanceTypes)
          .where(
            eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
          );
        await db
          .delete(schema.attendance)
          .where(eq(schema.attendance.id, attendanceId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const eventInstanceId of createdEventInstanceIds.reverse()) {
      try {
        await db
          .delete(schema.eventInstances)
          .where(eq(schema.eventInstances.id, eventInstanceId));
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const userId of createdUserIds.reverse()) {
      try {
        await cleanup.user(userId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }, 30000); // 30 second timeout for cleanup

  // Helper to create a test AO org with region parent
  const createTestAO = async () => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Test Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
      })
      .returning();

    if (region) {
      createdOrgIds.push(region.id);
    }

    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `Test AO ${uniqueId()}`,
        orgType: "ao",
        parentId: region?.id,
        isActive: true,
      })
      .returning();

    if (ao) {
      createdOrgIds.push(ao.id);
    }

    return { region, ao };
  };

  // Helper to create a test event instance
  const createTestEventInstance = async (orgId: number) => {
    const [eventInstance] = await db
      .insert(schema.eventInstances)
      .values({
        name: `Test Event ${uniqueId()}`,
        orgId,
        startDate: new Date().toISOString().split("T")[0]!,
        isActive: true,
        highlight: false,
      })
      .returning();

    if (eventInstance) {
      createdEventInstanceIds.push(eventInstance.id);
    }

    return eventInstance;
  };

  // Helper to create a test user
  const createTestUser = async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `test-${uniqueId()}@example.com`,
        f3Name: `TestUser ${uniqueId()}`,
      })
      .returning();

    if (user) {
      createdUserIds.push(user.id);
    }

    return user;
  };

  // Helper to give a user attendance with the given types: planned
  // (preblast) by default, actual (backblast) when isPlanned is false
  const createPlannedAttendanceWithTypes = async (
    eventInstanceId: number,
    userId: number,
    typeIds: number[],
    isPlanned = true,
  ) => {
    const [attendance] = await db
      .insert(schema.attendance)
      .values({ eventInstanceId, userId, isPlanned })
      .returning();
    createdAttendanceIds.push(attendance!.id);
    await db.insert(schema.attendanceXAttendanceTypes).values(
      typeIds.map((attendanceTypeId) => ({
        attendanceId: attendance!.id,
        attendanceTypeId,
      })),
    );
    return attendance!;
  };

  // Helper to list the users holding planned Q on an event instance
  const getPlannedQUserIds = async (eventInstanceId: number) => {
    const rows = await db
      .select({ userId: schema.attendance.userId })
      .from(schema.attendance)
      .innerJoin(
        schema.attendanceXAttendanceTypes,
        eq(
          schema.attendanceXAttendanceTypes.attendanceId,
          schema.attendance.id,
        ),
      )
      .where(
        and(
          eq(schema.attendance.eventInstanceId, eventInstanceId),
          eq(schema.attendance.isPlanned, true),
          eq(
            schema.attendanceXAttendanceTypes.attendanceTypeId,
            ATTENDANCE_TYPE_IDS!.Q,
          ),
        ),
      );
    return rows.map((row) => row.userId);
  };

  // Helper to read an attendance record's type ids, sorted
  const getTypeIds = async (attendanceId: number) => {
    const rows = await db
      .select({ id: schema.attendanceXAttendanceTypes.attendanceTypeId })
      .from(schema.attendanceXAttendanceTypes)
      .where(eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId));
    return rows.map((row) => row.id).sort((a, b) => a - b);
  };

  // Helper to sign in as a plain member
  const signInAs = async (user: {
    id: number;
    email: string;
    f3Name: string | null;
  }) => {
    await mockAuthWithSession(
      createUserSession({
        userId: user.id,
        email: user.email,
        f3Name: user.f3Name ?? undefined,
      }),
    );
  };

  describe("getForEventInstance", () => {
    it("should return empty attendance for new event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: true,
      });

      expect(result).toHaveProperty("attendance");
      expect(Array.isArray(result.attendance)).toBe(true);
      expect(result.attendance.length).toBe(0);
    });

    it("should return attendance records with user info", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      // Create attendance record
      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: true,
      });

      expect(result.attendance.length).toBe(1);
      expect(result.attendance[0]?.userId).toBe(user.id);
      expect(result.attendance[0]?.user?.f3Name).toBe(user.f3Name);
    });

    it("should filter by isPlanned flag", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      // Create planned attendance
      const [plannedAttendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (plannedAttendance) {
        createdAttendanceIds.push(plannedAttendance.id);
      }

      const client = createTestClient();

      // Get planned attendance
      const plannedResult = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: true,
      });
      expect(plannedResult.attendance.length).toBe(1);

      // Get actual attendance (should be empty)
      const actualResult = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: false,
      });
      expect(actualResult.attendance.length).toBe(0);
    });

    it("should not return attendee email in responses", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: true,
      });

      expect(result.attendance.length).toBe(1);
      expect(result.attendance[0]?.user?.f3Name).toBe(user.f3Name);
      expect(result.attendance[0]?.user).not.toHaveProperty("email");
    });

    it("should not return attendee email for editors on a different AO", async () => {
      const { ao: eventAo } = await createTestAO();
      const { ao: editorAo } = await createTestAO();
      if (!eventAo || !editorAo) return;

      const eventInstance = await createTestEventInstance(eventAo.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const editorSession = createEditorSession({
        orgId: editorAo.id,
        orgName: editorAo.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance.id,
        isPlanned: true,
      });

      expect(result.attendance.length).toBe(1);
      expect(result.attendance[0]?.user?.f3Name).toBe(user.f3Name);
      expect(result.attendance[0]?.user).not.toHaveProperty("email");
    });

    it("should return every attendance field callers read", async () => {
      await mockAuthWithSession(await createAdminSession());

      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const user = await createTestUser();
      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance!.id,
          userId: user!.id,
          isPlanned: true,
          meta: { source: "test" },
        })
        .returning();
      createdAttendanceIds.push(attendance!.id);

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance!.id,
        isPlanned: true,
      });

      expect(result.attendance).toEqual([
        {
          id: attendance!.id,
          userId: user!.id,
          eventInstanceId: eventInstance!.id,
          isPlanned: true,
          meta: { source: "test" },
          created: attendance!.created,
          user: { id: user!.id, f3Name: user!.f3Name },
          attendanceType: "pax",
          attendanceTypes: [{ id: ATTENDANCE_TYPE_IDS!.PAX, type: "PAX" }],
        },
      ]);
    });

    it("should return each record's attendance type as a single named value", async () => {
      await mockAuthWithSession(await createAdminSession());

      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const paxUser = await createTestUser();
      const qUser = await createTestUser();
      const coQUser = await createTestUser();
      const untypedUser = await createTestUser();
      const ids = ATTENDANCE_TYPE_IDS!;

      const pax = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        paxUser!.id,
        [ids.PAX],
      );
      // A Q who also signed up as PAX is reported as Q alone.
      const q = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        qUser!.id,
        [ids.Q, ids.PAX],
      );
      const coQ = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        coQUser!.id,
        [ids.COQ],
      );
      // A record with no type rows is PAX.
      const [untyped] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance!.id,
          userId: untypedUser!.id,
          isPlanned: true,
        })
        .returning();
      createdAttendanceIds.push(untyped!.id);

      const client = createTestClient();
      const result = await client.attendance.getForEventInstance({
        eventInstanceId: eventInstance!.id,
        isPlanned: true,
      });

      const byId = new Map(result.attendance.map((r) => [r.id, r]));
      expect(byId.get(pax.id)).toMatchObject({
        attendanceType: "pax",
        attendanceTypes: [{ id: ids.PAX, type: "PAX" }],
      });
      expect(byId.get(q.id)).toMatchObject({
        attendanceType: "q",
        attendanceTypes: [{ id: ids.Q, type: "Q" }],
      });
      expect(byId.get(coQ.id)).toMatchObject({
        attendanceType: "co_q",
        attendanceTypes: [{ id: ids.COQ, type: "Co-Q" }],
      });
      expect(byId.get(untyped!.id)).toMatchObject({
        attendanceType: "pax",
        attendanceTypes: [{ id: ids.PAX, type: "PAX" }],
      });
    });
  });
  describe("createPlanned", () => {
    it("should create planned attendance for a user", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX], // PAX attendance type
      });

      expect(result.success).toBe(true);
      expect(result.attendanceId).toBeDefined();

      if (result.attendanceId) {
        createdAttendanceIds.push(result.attendanceId);
      }

      // Verify attendance was created
      const [created] = await db
        .select()
        .from(schema.attendance)
        .where(eq(schema.attendance.id, result.attendanceId));

      expect(created).toBeDefined();
      expect(created?.userId).toBe(user.id);
      expect(created?.isPlanned).toBe(true);
    });

    it("should update existing planned attendance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();

      // Create first attendance with PAX type
      const result1 = await client.attendance.createPlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX], // PAX
      });

      if (result1.attendanceId) {
        createdAttendanceIds.push(result1.attendanceId);
      }

      // Update with Q type
      const result2 = await client.attendance.createPlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q], // PAX + Q
      });

      // Should return same attendance ID
      expect(result2.attendanceId).toBe(result1.attendanceId);
    });

    it("should throw NOT_FOUND for non-existent event instance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();

      await expect(
        client.attendance.createPlanned({
          eventInstanceId: 999999,
          userId: user.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("should allow users to create planned attendance for themselves", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const userSession = createUserSession({
        userId: user.id,
        email: user.email,
        f3Name: user.f3Name ?? undefined,
      });
      await mockAuthWithSession(userSession);

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
      });

      expect(result.success).toBe(true);
      if (result.attendanceId) {
        createdAttendanceIds.push(result.attendanceId);
      }
    });

    it("should allow users with string session id to create planned attendance for themselves", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const userSession = createUserSession({
        userId: user.id,
        email: user.email,
        f3Name: user.f3Name ?? undefined,
      });
      await mockAuthWithSession({
        ...userSession,
        // NextAuth stores user ids as strings on session.id
        id: String(user.id) as unknown as typeof userSession.id,
      });

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
      });

      expect(result.success).toBe(true);
      if (result.attendanceId) {
        createdAttendanceIds.push(result.attendanceId);
      }
    });

    it("should reject a member signing up as Q when another user is Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const scheduledQ = await createTestUser();
      const member = await createTestUser();

      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        scheduledQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );
      await signInAs(member!);

      const client = createTestClient();
      await expect(
        client.attendance.createPlanned({
          eventInstanceId: eventInstance!.id,
          userId: member!.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([
        scheduledQ!.id,
      ]);
      const memberAttendance = await db
        .select()
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstance!.id),
            eq(schema.attendance.userId, member!.id),
          ),
        );
      expect(memberAttendance).toEqual([]);
    });

    it("should reject an editor signing a second user up as Q", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const scheduledQ = await createTestUser();
      const other = await createTestUser();

      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        scheduledQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );

      const client = createTestClient();
      await expect(
        client.attendance.createPlanned({
          eventInstanceId: eventInstance!.id,
          userId: other!.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([
        scheduledQ!.id,
      ]);
    });

    it("should let a member sign up as Q when the event has no Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const member = await createTestUser();
      await signInAs(member!);

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance!.id,
        userId: member!.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
      });
      createdAttendanceIds.push(result.attendanceId);

      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([member!.id]);
    });

    it("should let the current Q re-submit their sign-up with Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const q = await createTestUser();
      const attendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        q!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );
      await signInAs(q!);

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance!.id,
        userId: q!.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
      });

      expect(result.attendanceId).toBe(attendance.id);
      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([q!.id]);
    });

    it("should let a member sign up as PAX when another user is Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const scheduledQ = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        scheduledQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );
      await signInAs(member!);

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance!.id,
        userId: member!.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
      });
      createdAttendanceIds.push(result.attendanceId);

      expect(await getTypeIds(result.attendanceId)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
      ]);
      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([
        scheduledQ!.id,
      ]);
    });

    it("should let a member sign up as Q when another user is Co-Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const coQ = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(eventInstance!.id, coQ!.id, [
        ATTENDANCE_TYPE_IDS!.COQ,
      ]);
      await signInAs(member!);

      const client = createTestClient();
      const result = await client.attendance.createPlanned({
        eventInstanceId: eventInstance!.id,
        userId: member!.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.Q],
      });
      createdAttendanceIds.push(result.attendanceId);

      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([member!.id]);
    });

    it("should reject creating planned attendance for another user", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.createPlanned({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("createActual", () => {
    it("should create actual attendance for backblast", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();
      const result = await client.attendance.createActual({
        eventInstanceId: eventInstance.id,
        userId: user.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX], // PAX
      });

      expect(result.success).toBe(true);
      expect(result.attendanceId).toBeDefined();

      if (result.attendanceId) {
        createdAttendanceIds.push(result.attendanceId);
      }

      // Verify attendance was created with isPlanned=false
      const [created] = await db
        .select()
        .from(schema.attendance)
        .where(eq(schema.attendance.id, result.attendanceId));

      expect(created?.isPlanned).toBe(false);
    });

    it("should reject creating actual attendance without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.createActual({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should reject creating actual attendance for self without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const userSession = createUserSession({
        userId: user.id,
        email: user.email,
        f3Name: user.f3Name ?? undefined,
      });
      await mockAuthWithSession(userSession);

      const client = createTestClient();
      await expect(
        client.attendance.createActual({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should reject creating actual attendance as editor on a different org (cross-org IDOR)", async () => {
      const { ao: eventAo } = await createTestAO();
      const { ao: editorAo } = await createTestAO();
      if (!eventAo || !editorAo) return;

      const eventInstance = await createTestEventInstance(eventAo.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const editorSession = createEditorSession({
        orgId: editorAo.id,
        orgName: editorAo.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      await expect(
        client.attendance.createActual({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("removePlanned", () => {
    it("should remove planned attendance", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      // Create attendance
      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const client = createTestClient();
      const result = await client.attendance.removePlanned({
        eventInstanceId: eventInstance.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);

      // Verify attendance was deleted
      const remaining = await db
        .select()
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstance.id),
            eq(schema.attendance.userId, user.id),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      expect(remaining.length).toBe(0);
    });

    it("should reject removing another user's planned attendance", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.removePlanned({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("takeQ", () => {
    it("should assign Q to a user", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();
      const result = await client.attendance.takeQ({
        eventInstanceId: eventInstance.id,
        userId: user.id,
      });

      expect(result.success).toBe(true);
      expect(result.attendanceId).toBeDefined();

      if (result.attendanceId) {
        createdAttendanceIds.push(result.attendanceId);
      }

      // Verify Q attendance type was created
      const attendanceTypes = await db
        .select()
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            result.attendanceId,
          ),
        );

      // Should have both PAX (1) and Q (2) types
      const typeIds = attendanceTypes.map((at) => at.attendanceTypeId);
      expect(typeIds).toContain(ATTENDANCE_TYPE_IDS!.PAX); // PAX
      expect(typeIds).toContain(ATTENDANCE_TYPE_IDS!.Q); // Q
    });

    it("should add Q to a user already signed up as PAX", async () => {
      await mockAuthWithSession(await createAdminSession());
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const user = await createTestUser();
      const existing = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        user!.id,
        [ATTENDANCE_TYPE_IDS!.PAX],
      );

      const client = createTestClient();
      const result = await client.attendance.takeQ({
        eventInstanceId: eventInstance!.id,
        userId: user!.id,
      });

      expect(result.attendanceId).toBe(existing.id);
      expect(await getTypeIds(existing.id)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
      const [row] = await db
        .select({ attendanceType: schema.attendance.attendanceType })
        .from(schema.attendance)
        .where(eq(schema.attendance.id, existing.id));
      expect(row?.attendanceType).toBe("q");
    });

    it("should leave a user who is already Q unchanged when they take Q again", async () => {
      await mockAuthWithSession(await createAdminSession());
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const user = await createTestUser();
      const existing = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        user!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );

      const client = createTestClient();
      const result = await client.attendance.takeQ({
        eventInstanceId: eventInstance!.id,
        userId: user!.id,
      });

      expect(result.attendanceId).toBe(existing.id);
      expect(await getTypeIds(existing.id)).toEqual([ATTENDANCE_TYPE_IDS!.Q]);
    });

    it("should throw CONFLICT when Q already assigned to another user", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user1 = await createTestUser();
      const user2 = await createTestUser();
      if (!user1 || !user2) return;

      const client = createTestClient();

      // User1 takes Q
      const result1 = await client.attendance.takeQ({
        eventInstanceId: eventInstance.id,
        userId: user1.id,
      });

      if (result1.attendanceId) {
        createdAttendanceIds.push(result1.attendanceId);
      }

      // User2 tries to take Q - should fail
      await expect(
        client.attendance.takeQ({
          eventInstanceId: eventInstance.id,
          userId: user2.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("should reject taking Q for another user without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.takeQ({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("removeQ", () => {
    it("should remove Q status from user", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const client = createTestClient();

      // Take Q first
      const takeResult = await client.attendance.takeQ({
        eventInstanceId: eventInstance.id,
        userId: user.id,
      });

      if (takeResult.attendanceId) {
        createdAttendanceIds.push(takeResult.attendanceId);
      }

      // Remove Q
      const removeResult = await client.attendance.removeQ({
        eventInstanceId: eventInstance.id,
        userId: user.id,
      });

      expect(removeResult.success).toBe(true);

      // Verify Q type was removed (should only have PAX left)
      const attendanceTypes = await db
        .select()
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            takeResult.attendanceId,
          ),
        );

      const typeIds = attendanceTypes.map((at) => at.attendanceTypeId);
      expect(typeIds).not.toContain(ATTENDANCE_TYPE_IDS!.Q); // Q should be removed
    });

    it("should reject removing Q for another user without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
        await db.insert(schema.attendanceXAttendanceTypes).values({
          attendanceId: attendance.id,
          attendanceTypeId: ATTENDANCE_TYPE_IDS!.Q,
        });
      }

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.removeQ({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("updateAttendanceTypes", () => {
    it("should allow a user to update attendance types for their own attendance", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const userSession = createUserSession({
        userId: user.id,
        email: user.email,
        f3Name: user.f3Name ?? undefined,
      });
      await mockAuthWithSession(userSession);

      const client = createTestClient();
      const result = await client.attendance.updateAttendanceTypes({
        attendanceId: attendance!.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
      });

      expect(result.success).toBe(true);
    });

    it("should reject a member adding Q to their attendance when another user is Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const scheduledQ = await createTestUser();
      const member = await createTestUser();

      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        scheduledQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );
      const memberAttendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        member!.id,
        [ATTENDANCE_TYPE_IDS!.PAX],
      );
      await signInAs(member!);

      const client = createTestClient();
      await expect(
        client.attendance.updateAttendanceTypes({
          attendanceId: memberAttendance.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([
        scheduledQ!.id,
      ]);
      const memberTypes = await db
        .select()
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            memberAttendance.id,
          ),
        );
      expect(memberTypes.map((t) => t.attendanceTypeId)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
      ]);
    });

    it("should let the current Q keep Q while changing their other types", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const q = await createTestUser();
      const attendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        q!.id,
        [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
      );
      await signInAs(q!);

      const client = createTestClient();
      await client.attendance.updateAttendanceTypes({
        attendanceId: attendance.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.Q],
      });

      const types = await db
        .select()
        .from(schema.attendanceXAttendanceTypes)
        .where(
          eq(schema.attendanceXAttendanceTypes.attendanceId, attendance.id),
        );
      expect(types.map((t) => t.attendanceTypeId)).toEqual([
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
    });

    it("should let one of two existing Qs change their other types", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const qA = await createTestUser();
      const qB = await createTestUser();
      const attendanceA = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        qA!.id,
        [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
      );
      await createPlannedAttendanceWithTypes(eventInstance!.id, qB!.id, [
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
      await signInAs(qA!);

      const client = createTestClient();
      await client.attendance.updateAttendanceTypes({
        attendanceId: attendanceA.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.Q],
      });

      expect(await getTypeIds(attendanceA.id)).toEqual([
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
    });

    it("should reject a third user adding Q when the event has two Qs", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const qA = await createTestUser();
      const qB = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(eventInstance!.id, qA!.id, [
        ATTENDANCE_TYPE_IDS!.PAX,
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
      await createPlannedAttendanceWithTypes(eventInstance!.id, qB!.id, [
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
      const memberAttendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        member!.id,
        [ATTENDANCE_TYPE_IDS!.PAX],
      );
      await signInAs(member!);

      const client = createTestClient();
      await expect(
        client.attendance.updateAttendanceTypes({
          attendanceId: memberAttendance.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await getTypeIds(memberAttendance.id)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
      ]);
      const qUserIds = await getPlannedQUserIds(eventInstance!.id);
      expect(qUserIds.sort((a, b) => a - b)).toEqual(
        [qA!.id, qB!.id].sort((a, b) => a - b),
      );
    });

    it("should let a member change non-Q types when another user is Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const scheduledQ = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        scheduledQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
      );
      const memberAttendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        member!.id,
        [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.COQ],
      );
      await signInAs(member!);

      const client = createTestClient();
      await client.attendance.updateAttendanceTypes({
        attendanceId: memberAttendance.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX],
      });

      expect(await getTypeIds(memberAttendance.id)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
      ]);
    });

    it("should reject a member adding Q to their actual attendance when another user is the actual Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const actualQ = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        actualQ!.id,
        [ATTENDANCE_TYPE_IDS!.Q],
        false,
      );
      const memberAttendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        member!.id,
        [ATTENDANCE_TYPE_IDS!.PAX],
        false,
      );
      await signInAs(member!);

      const client = createTestClient();
      await expect(
        client.attendance.updateAttendanceTypes({
          attendanceId: memberAttendance.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(await getTypeIds(memberAttendance.id)).toEqual([
        ATTENDANCE_TYPE_IDS!.PAX,
      ]);
    });

    it("should let a member record Q on actual attendance when someone else was the planned Q", async () => {
      const { ao } = await createTestAO();
      const eventInstance = await createTestEventInstance(ao!.id);
      const plannedQ = await createTestUser();
      const member = await createTestUser();
      await createPlannedAttendanceWithTypes(eventInstance!.id, plannedQ!.id, [
        ATTENDANCE_TYPE_IDS!.Q,
      ]);
      const memberAttendance = await createPlannedAttendanceWithTypes(
        eventInstance!.id,
        member!.id,
        [ATTENDANCE_TYPE_IDS!.PAX],
        false,
      );
      await signInAs(member!);

      const client = createTestClient();
      await client.attendance.updateAttendanceTypes({
        attendanceId: memberAttendance.id,
        attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q],
      });

      expect(await getTypeIds(memberAttendance.id)).toEqual(
        [ATTENDANCE_TYPE_IDS!.PAX, ATTENDANCE_TYPE_IDS!.Q].sort(
          (a, b) => a - b,
        ),
      );
      expect(await getPlannedQUserIds(eventInstance!.id)).toEqual([
        plannedQ!.id,
      ]);
    });

    it("should reject updating attendance types for another user without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const targetUser = await createTestUser();
      if (!targetUser) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: targetUser.id,
          isPlanned: true,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.updateAttendanceTypes({
          attendanceId: attendance!.id,
          attendanceTypeIds: [ATTENDANCE_TYPE_IDS!.Q],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("assignQAndCoQs", () => {
    it("should assign Q and Co-Qs to an event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const qUser = await createTestUser();
      const coQUser = await createTestUser();
      if (!qUser || !coQUser) return;

      const client = createTestClient();
      const result = await client.attendance.assignQAndCoQs({
        eventInstanceId: eventInstance.id,
        qUserId: qUser.id,
        coQUserIds: [coQUser.id],
      });

      expect(result.success).toBe(true);

      // Verify Q and Co-Q were assigned
      const attendance = await db
        .select({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
        })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstance.id),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      // Track for cleanup
      attendance.forEach((a) => createdAttendanceIds.push(a.id));

      expect(attendance.length).toBe(2);

      // Verify attendance types
      const qAttendance = attendance.find((a) => a.userId === qUser.id);
      const coQAttendance = attendance.find((a) => a.userId === coQUser.id);

      expect(qAttendance).toBeDefined();
      expect(coQAttendance).toBeDefined();

      if (qAttendance) {
        const qTypes = await db
          .select()
          .from(schema.attendanceXAttendanceTypes)
          .where(
            eq(schema.attendanceXAttendanceTypes.attendanceId, qAttendance.id),
          );
        const qTypeIds = qTypes.map((t) => t.attendanceTypeId);
        expect(qTypeIds).toEqual([ATTENDANCE_TYPE_IDS!.Q]); // Q type only
      }

      if (coQAttendance) {
        const coQTypes = await db
          .select()
          .from(schema.attendanceXAttendanceTypes)
          .where(
            eq(
              schema.attendanceXAttendanceTypes.attendanceId,
              coQAttendance.id,
            ),
          );
        const coQTypeIds = coQTypes.map((t) => t.attendanceTypeId);
        expect(coQTypeIds).toEqual([ATTENDANCE_TYPE_IDS!.COQ]); // Co-Q type only
      }
    });

    it("should demote prior Q and Co-Q users to PAX when no longer assigned", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const oldQUser = await createTestUser();
      const oldCoQUser = await createTestUser();
      const newQUser = await createTestUser();
      if (!oldQUser || !oldCoQUser || !newQUser) return;

      const oldAttendance = await db
        .insert(schema.attendance)
        .values([
          {
            eventInstanceId: eventInstance.id,
            userId: oldQUser.id,
            isPlanned: true,
          },
          {
            eventInstanceId: eventInstance.id,
            userId: oldCoQUser.id,
            isPlanned: true,
          },
        ])
        .returning({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
        });

      oldAttendance.forEach((attendance) =>
        createdAttendanceIds.push(attendance.id),
      );

      await db.insert(schema.attendanceXAttendanceTypes).values(
        oldAttendance.map((attendance) => ({
          attendanceId: attendance.id,
          attendanceTypeId:
            attendance.userId === oldQUser.id
              ? ATTENDANCE_TYPE_IDS!.Q
              : ATTENDANCE_TYPE_IDS!.COQ,
        })),
      );

      const client = createTestClient();
      const result = await client.attendance.assignQAndCoQs({
        eventInstanceId: eventInstance.id,
        qUserId: newQUser.id,
        coQUserIds: [],
      });

      expect(result.success).toBe(true);

      const [newQAttendance] = await db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstance.id),
            eq(schema.attendance.userId, newQUser.id),
          ),
        );
      if (newQAttendance) createdAttendanceIds.push(newQAttendance.id);

      const attendanceTypes = await db
        .select()
        .from(schema.attendanceXAttendanceTypes)
        .where(
          inArray(
            schema.attendanceXAttendanceTypes.attendanceId,
            oldAttendance.map((attendance) => attendance.id),
          ),
        );

      for (const attendance of oldAttendance) {
        expect(
          attendanceTypes
            .filter((type) => type.attendanceId === attendance.id)
            .map((type) => type.attendanceTypeId),
        ).toEqual([ATTENDANCE_TYPE_IDS!.PAX]);
      }
    });

    it("should reject assigning Q and Co-Qs without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const qUser = await createTestUser();
      if (!qUser) return;

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.assignQAndCoQs({
          eventInstanceId: eventInstance.id,
          qUserId: qUser.id,
          coQUserIds: [],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should reject assigning Q as editor on a different org (cross-org IDOR)", async () => {
      const { ao: eventAo } = await createTestAO();
      const { ao: editorAo } = await createTestAO();
      if (!eventAo || !editorAo) return;

      const eventInstance = await createTestEventInstance(eventAo.id);
      if (!eventInstance) return;

      const qUser = await createTestUser();
      if (!qUser) return;

      const editorSession = createEditorSession({
        orgId: editorAo.id,
        orgName: editorAo.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      await expect(
        client.attendance.assignQAndCoQs({
          eventInstanceId: eventInstance.id,
          qUserId: qUser.id,
          coQUserIds: [],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("deleteActualForEvent", () => {
    it("should delete all actual attendance for an event", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user1 = await createTestUser();
      const user2 = await createTestUser();
      if (!user1 || !user2) return;

      // Create actual attendance for both users
      await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user1.id,
          isPlanned: false,
        })
        .returning();

      await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user2.id,
          isPlanned: false,
        })
        .returning();

      // Don't add to cleanup since we're deleting them

      const client = createTestClient();
      const result = await client.attendance.deleteActualForEvent({
        eventInstanceId: eventInstance.id,
      });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);

      // Verify deletion
      const remaining = await db
        .select()
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstance.id),
            eq(schema.attendance.isPlanned, false),
          ),
        );

      expect(remaining.length).toBe(0);
    });

    it("should reject deleting actual attendance without editor role", async () => {
      const { ao } = await createTestAO();
      if (!ao) return;

      const eventInstance = await createTestEventInstance(ao.id);
      if (!eventInstance) return;

      const user = await createTestUser();
      if (!user) return;

      const [attendance] = await db
        .insert(schema.attendance)
        .values({
          eventInstanceId: eventInstance.id,
          userId: user.id,
          isPlanned: false,
        })
        .returning();

      if (attendance) {
        createdAttendanceIds.push(attendance.id);
      }

      const noPermSession = createNoPermissionSession();
      await mockAuthWithSession(noPermSession);

      const client = createTestClient();
      await expect(
        client.attendance.deleteActualForEvent({
          eventInstanceId: eventInstance.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("should reject deleting actual attendance as editor on a different org (cross-org IDOR)", async () => {
      const { ao: eventAo } = await createTestAO();
      const { ao: editorAo } = await createTestAO();
      if (!eventAo || !editorAo) return;

      const eventInstance = await createTestEventInstance(eventAo.id);
      if (!eventInstance) return;

      const editorSession = createEditorSession({
        orgId: editorAo.id,
        orgName: editorAo.name,
      });
      await mockAuthWithSession(editorSession);

      const client = createTestClient();
      await expect(
        client.attendance.deleteActualForEvent({
          eventInstanceId: eventInstance.id,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
