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
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

import { and, eq, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createNoPermissionSession,
  createTestClient,
  createUserSession,
  db,
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
  if (ATTENDANCE_TYPE_IDS) return ATTENDANCE_TYPE_IDS;

  // Check for existing PAX type
  let [paxType] = await db
    .select()
    .from(schema.attendanceTypes)
    .where(eq(schema.attendanceTypes.type, "PAX"));

  if (!paxType) {
    [paxType] = await db
      .insert(schema.attendanceTypes)
      .values({ type: "PAX", description: "Regular attendee" })
      .returning();
  }

  // Check for existing Q type
  let [qType] = await db
    .select()
    .from(schema.attendanceTypes)
    .where(eq(schema.attendanceTypes.type, "Q"));

  if (!qType) {
    [qType] = await db
      .insert(schema.attendanceTypes)
      .values({ type: "Q", description: "Workout leader" })
      .returning();
  }

  // Check for existing Co-Q type
  let [coQType] = await db
    .select()
    .from(schema.attendanceTypes)
    .where(eq(schema.attendanceTypes.type, "Co-Q"));

  if (!coQType) {
    [coQType] = await db
      .insert(schema.attendanceTypes)
      .values({ type: "Co-Q", description: "Co-leader" })
      .returning();
  }

  ATTENDANCE_TYPE_IDS = {
    PAX: paxType!.id,
    Q: qType!.id,
    COQ: coQType!.id,
  };

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

    it("should reject actual attendance reads for users without editor role", async () => {
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
        client.attendance.getForEventInstance({
          eventInstanceId: eventInstance.id,
          isPlanned: false,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
    });
  });

  describe("updateAttendanceTypes", () => {
    it("should reject updating attendance types without editor role", async () => {
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
      ).rejects.toThrow();
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
        expect(qTypeIds).toContain(ATTENDANCE_TYPE_IDS!.Q); // Q type
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
        expect(coQTypeIds).toContain(ATTENDANCE_TYPE_IDS!.COQ); // Co-Q type
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
    });
  });
});
