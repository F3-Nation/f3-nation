import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, eq, inArray, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { ATTENDANCE_TYPE_IDS } from "@acme/shared/app/constants";
import { AttendanceType } from "@acme/shared/app/enums";
import { queryBooleanSchema } from "@acme/shared/app/functions";

import {
  assertEditorOnEventOrg,
  assertSelfOrEditorOnEventOrg,
} from "../lib/attendance-auth";
import { protectedProcedure } from "../shared";

/**
 * The `attendance_types` row each `attendance.attendance_type` value stands
 * for, reported in the deprecated `attendanceTypes` response field.
 */
const LEGACY_ATTENDANCE_TYPES = {
  pax: { id: ATTENDANCE_TYPE_IDS.PAX, type: "PAX" },
  q: { id: ATTENDANCE_TYPE_IDS.Q, type: "Q" },
  co_q: { id: ATTENDANCE_TYPE_IDS.COQ, type: "Co-Q" },
} as const satisfies Record<AttendanceType, { id: number; type: string }>;

/** What each attendance type means, for the API docs. */
const ATTENDANCE_TYPE_MEANINGS = {
  pax: "attendee",
  q: "leader",
  co_q: "co-leader",
} as const satisfies Record<AttendanceType, string>;

/**
 * Refuses a write that would give `userId` the Q type on an event instance
 * where a different user already holds Q in the same (planned or actual)
 * attendance set. A user who already holds Q there may keep it. Editors
 * move planned Q with `assignQAndCoQs`; for actual attendance, remove Q from
 * the current holder first.
 */
async function assertNoOtherQ(
  db: Pick<AppDb, "select">,
  {
    eventInstanceId,
    userId,
    isPlanned,
  }: {
    eventInstanceId: number;
    userId: number;
    isPlanned: boolean;
  },
) {
  const existingQ = await db
    .select({ userId: schema.attendance.userId })
    .from(schema.attendance)
    .where(
      and(
        eq(schema.attendance.eventInstanceId, eventInstanceId),
        eq(schema.attendance.isPlanned, isPlanned),
        eq(schema.attendance.attendanceType, "q"),
      ),
    );

  if (existingQ.some((q) => q.userId === userId)) return;
  if (existingQ.length > 0) {
    throw new ORPCError("CONFLICT", {
      message: "Event already has a Q assigned",
    });
  }
}

/**
 * Attendance Router
 * Manages attendance records for event instances.
 * Supports HC/Q/Co-Q operations for preblasts and backblasts.
 */
export const attendanceRouter = {
  /**
   * Get all attendance records for an event instance.
   * Includes user info (f3Name) and attendance types.
   */
  getForEventInstance: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        // Preserve Python Boolean spellings for existing attendance callers.
        isPlanned: queryBooleanSchema
          .or(z.enum(["True", "False"]).transform((value) => value === "True"))
          .optional()
          .default(true),
      }),
    )
    .route({
      method: "GET",
      path: "/event-instance/{eventInstanceId}",
      tags: ["attendance"],
      summary: "Get attendance for event instance",
      description:
        "Get all attendance records for an event instance with user info and types",
    })
    .output(
      z.object({
        attendance: z
          .array(
            z.object({
              id: z.number().describe("Attendance record ID"),
              userId: z.number().describe("Attending user ID"),
              eventInstanceId: z.number().describe("Event instance ID"),
              isPlanned: z
                .boolean()
                .describe(
                  "True for planned attendance (preblast), false for actual attendance (backblast)",
                ),
              meta: z
                .record(z.string(), z.unknown())
                .nullable()
                .describe("Free-form attendance metadata"),
              created: z.string().describe("When the record was created (UTC)"),
              user: z
                .object({
                  id: z.number().describe("User ID"),
                  f3Name: z.string().nullable().describe("User's F3 name"),
                })
                .nullable()
                .describe("The attending user"),
              attendanceType: z
                .enum(AttendanceType)
                .describe(
                  `The capacity the user attends in: ${AttendanceType.map(
                    (type) => `\`${type}\` (${ATTENDANCE_TYPE_MEANINGS[type]})`,
                  ).join(", ")}`,
                ),
              attendanceTypes: z
                .array(
                  z.object({
                    id: z.number().describe("Attendance type ID"),
                    type: z
                      .enum(
                        Object.values(LEGACY_ATTENDANCE_TYPES).map(
                          (t) => t.type,
                        ),
                      )
                      .describe("Attendance type name"),
                  }),
                )
                .describe(
                  "Deprecated: one entry naming `attendanceType` by its numeric type ID. Read `attendanceType` instead.",
                ),
            }),
          )
          .describe("Attendance records for the event instance"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // Get attendance records with user info
      const attendanceRecords = await ctx.db
        .select({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
          eventInstanceId: schema.attendance.eventInstanceId,
          isPlanned: schema.attendance.isPlanned,
          meta: schema.attendance.meta,
          created: schema.attendance.created,
          user: {
            id: schema.users.id,
            f3Name: schema.users.f3Name,
          },
          attendanceType: schema.attendance.attendanceType,
        })
        .from(schema.attendance)
        .leftJoin(schema.users, eq(schema.users.id, schema.attendance.userId))
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.isPlanned, input.isPlanned),
          ),
        );

      return {
        attendance: attendanceRecords.map((record) => ({
          ...record,
          attendanceTypes: [LEGACY_ATTENDANCE_TYPES[record.attendanceType]],
          user: record.user
            ? {
                id: record.user.id,
                f3Name: record.user.f3Name,
              }
            : record.user,
        })),
      };
    }),

  /**
   * Create planned attendance for a user on an event instance
   * Used for HC/Q/Co-Q sign-ups from preblast
   */
  createPlanned: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        userId: z.coerce.number(),
        attendanceTypeIds: z.array(z.coerce.number()),
      }),
    )
    .route({
      method: "POST",
      path: "/",
      tags: ["attendance"],
      summary: "Create planned attendance",
      description:
        "Create a new planned attendance record with specified attendance types",
    })
    .output(
      z.object({
        success: z.boolean().describe("Always true; a failure throws an error"),
        attendanceId: z
          .number()
          .describe("ID of the created or updated planned attendance record"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to create planned attendance",
      });

      if (input.attendanceTypeIds.includes(ATTENDANCE_TYPE_IDS.Q)) {
        await assertNoOtherQ(ctx.db, {
          eventInstanceId: input.eventInstanceId,
          userId: input.userId,
          isPlanned: true,
        });
      }

      // Check if user already has attendance for this event
      const existingAttendance = await ctx.db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.userId, input.userId),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      let attendanceId: number;

      if (existingAttendance.length > 0) {
        // Update existing attendance - clear old types and add new ones
        attendanceId = existingAttendance[0]!.id;

        // Delete existing attendance type links
        await ctx.db
          .delete(schema.attendanceXAttendanceTypes)
          .where(
            eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
          );
      } else {
        // Create new attendance record
        const [newAttendance] = await ctx.db
          .insert(schema.attendance)
          .values({
            eventInstanceId: input.eventInstanceId,
            userId: input.userId,
            isPlanned: true,
          })
          .returning({ id: schema.attendance.id });

        if (!newAttendance) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create attendance record",
          });
        }

        attendanceId = newAttendance.id;
      }

      // Create attendance type links
      if (input.attendanceTypeIds.length > 0) {
        await ctx.db.insert(schema.attendanceXAttendanceTypes).values(
          input.attendanceTypeIds.map((typeId) => ({
            attendanceId,
            attendanceTypeId: typeId,
          })),
        );
      }

      return { success: true, attendanceId };
    }),

  /**
   * Create actual (non-planned) attendance for backblast submissions.
   * This creates attendance records with isPlanned=false.
   */
  createActual: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        userId: z.coerce.number(),
        attendanceTypeIds: z.array(z.coerce.number()),
      }),
    )
    .route({
      method: "POST",
      path: "/actual",
      tags: ["attendance"],
      summary: "Create actual attendance",
      description:
        "Create a new actual attendance record (for backblast submissions)",
    })
    .handler(async ({ context: ctx, input }) => {
      await assertEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        message: "You are not authorized to create actual attendance",
      });

      // Check if user already has actual attendance for this event
      const existingAttendance = await ctx.db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.userId, input.userId),
            eq(schema.attendance.isPlanned, false),
          ),
        );

      let attendanceId: number;

      if (existingAttendance.length > 0) {
        // Update existing attendance - clear old types and add new ones
        attendanceId = existingAttendance[0]!.id;

        // Delete existing attendance type links
        await ctx.db
          .delete(schema.attendanceXAttendanceTypes)
          .where(
            eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
          );
      } else {
        // Create new attendance record with isPlanned=false
        const [newAttendance] = await ctx.db
          .insert(schema.attendance)
          .values({
            eventInstanceId: input.eventInstanceId,
            userId: input.userId,
            isPlanned: false,
          })
          .returning({ id: schema.attendance.id });

        if (!newAttendance) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create attendance record",
          });
        }

        attendanceId = newAttendance.id;
      }

      // Create attendance type links
      if (input.attendanceTypeIds.length > 0) {
        await ctx.db.insert(schema.attendanceXAttendanceTypes).values(
          input.attendanceTypeIds.map((typeId) => ({
            attendanceId,
            attendanceTypeId: typeId,
          })),
        );
      }

      return { success: true, attendanceId };
    }),

  /**
   * Delete all actual (non-planned) attendance for an event instance.
   * Used before re-submitting a backblast.
   */
  deleteActualForEvent: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
      }),
    )
    .route({
      method: "DELETE",
      path: "/event-instance/{eventInstanceId}/actual",
      tags: ["attendance"],
      summary: "Delete actual attendance for event",
      description:
        "Delete all actual attendance records for an event (for backblast re-submission)",
    })
    .handler(async ({ context: ctx, input }) => {
      await assertEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        message: "You are not authorized to delete actual attendance",
      });

      // Get all actual attendance IDs for this event
      const actualAttendance = await ctx.db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.isPlanned, false),
          ),
        );

      if (actualAttendance.length === 0) {
        return { success: true, deletedCount: 0 };
      }

      const attendanceIds = actualAttendance.map((a) => a.id);

      // Delete attendance type links first
      await ctx.db
        .delete(schema.attendanceXAttendanceTypes)
        .where(
          inArray(
            schema.attendanceXAttendanceTypes.attendanceId,
            attendanceIds,
          ),
        );

      // Delete attendance records
      const deleted = await ctx.db
        .delete(schema.attendance)
        .where(inArray(schema.attendance.id, attendanceIds))
        .returning({ id: schema.attendance.id });

      return {
        success: true,
        deletedCount: deleted.length,
      };
    }),

  /**
   * Remove planned attendance for a user on an event instance
   */
  removePlanned: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        userId: z.coerce.number(),
      }),
    )
    .route({
      method: "DELETE",
      path: "/event-instance/{eventInstanceId}/user/{userId}",
      tags: ["attendance"],
      summary: "Remove planned attendance",
      description: "Remove planned attendance record for a user",
    })
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to remove planned attendance",
      });

      // Find and delete the attendance record
      const deleted = await ctx.db
        .delete(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.userId, input.userId),
            eq(schema.attendance.isPlanned, true),
          ),
        )
        .returning({ id: schema.attendance.id });

      return {
        success: true,
        deletedCount: deleted.length,
      };
    }),

  /**
   * Update attendance types for an existing attendance record
   * Used for changing Q/Co-Q status without removing HC
   */
  updateAttendanceTypes: protectedProcedure
    .input(
      z.object({
        attendanceId: z.coerce.number(),
        attendanceTypeIds: z.array(z.coerce.number()),
      }),
    )
    .route({
      method: "PATCH",
      path: "/{attendanceId}/types",
      tags: ["attendance"],
      summary: "Update attendance types",
      description:
        "Update the attendance types for an existing attendance record",
    })
    .output(
      z.object({
        success: z.boolean().describe("Always true; a failure throws an error"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [attendance] = await ctx.db
        .select({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
          eventInstanceId: schema.attendance.eventInstanceId,
          isPlanned: schema.attendance.isPlanned,
        })
        .from(schema.attendance)
        .where(eq(schema.attendance.id, input.attendanceId));

      if (!attendance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Attendance record not found",
        });
      }

      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: attendance.eventInstanceId,
        targetUserId: attendance.userId,
        message: "You are not authorized to update attendance types",
      });

      if (input.attendanceTypeIds.includes(ATTENDANCE_TYPE_IDS.Q)) {
        await assertNoOtherQ(ctx.db, {
          eventInstanceId: attendance.eventInstanceId,
          userId: attendance.userId,
          isPlanned: attendance.isPlanned,
        });
      }

      // Delete existing type links
      await ctx.db
        .delete(schema.attendanceXAttendanceTypes)
        .where(
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            input.attendanceId,
          ),
        );

      // Create new type links
      if (input.attendanceTypeIds.length > 0) {
        await ctx.db.insert(schema.attendanceXAttendanceTypes).values(
          input.attendanceTypeIds.map((typeId) => ({
            attendanceId: input.attendanceId,
            attendanceTypeId: typeId,
          })),
        );
      }

      return { success: true };
    }),

  /**
   * Take Q for an event - adds user as Q (primary leader)
   * Convenience endpoint that handles Q attendance type specifically
   */
  takeQ: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        userId: z.coerce.number(),
      }),
    )
    .route({
      method: "POST",
      path: "/take-q",
      tags: ["attendance"],
      summary: "Take Q for event",
      description: "Sign up as Q (primary workout leader) for an event",
    })
    .output(
      z.object({
        success: z.boolean().describe("Always true; a failure throws an error"),
        attendanceId: z
          .number()
          .describe("ID of the user's planned attendance record"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to take Q for this event",
      });

      await assertNoOtherQ(ctx.db, {
        eventInstanceId: input.eventInstanceId,
        userId: input.userId,
        isPlanned: true,
      });

      // Check if user already has attendance
      const existingAttendance = await ctx.db
        .select({
          id: schema.attendance.id,
          attendanceType: schema.attendance.attendanceType,
        })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.userId, input.userId),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      let attendanceId: number;

      if (existingAttendance.length > 0) {
        attendanceId = existingAttendance[0]!.id;

        // Add Q type to existing attendance (keep other types)
        if (existingAttendance[0]!.attendanceType !== "q") {
          await ctx.db.insert(schema.attendanceXAttendanceTypes).values({
            attendanceId,
            attendanceTypeId: ATTENDANCE_TYPE_IDS.Q,
          });
        }
      } else {
        // Create new attendance with Q type
        const [newAttendance] = await ctx.db
          .insert(schema.attendance)
          .values({
            eventInstanceId: input.eventInstanceId,
            userId: input.userId,
            isPlanned: true,
          })
          .returning({ id: schema.attendance.id });

        if (!newAttendance) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create attendance record",
          });
        }

        attendanceId = newAttendance.id;

        // Add Q and PAX types
        await ctx.db.insert(schema.attendanceXAttendanceTypes).values([
          { attendanceId, attendanceTypeId: ATTENDANCE_TYPE_IDS.Q },
          { attendanceId, attendanceTypeId: ATTENDANCE_TYPE_IDS.PAX },
        ]);
      }

      return { success: true, attendanceId };
    }),

  /**
   * Remove Q status for user on an event
   * Keeps the attendance record but removes Q type
   */
  removeQ: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        userId: z.coerce.number(),
      }),
    )
    .route({
      method: "DELETE",
      path: "/remove-q",
      tags: ["attendance"],
      summary: "Remove Q status",
      description: "Remove Q status from attendance (keeps HC status)",
    })
    .output(
      z.object({
        success: z.boolean().describe("Always true; a failure throws an error"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to remove Q status",
      });

      // Find the attendance record
      const [attendance] = await ctx.db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.userId, input.userId),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      if (!attendance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Attendance record not found",
        });
      }

      // Remove Q and Co-Q types
      await ctx.db
        .delete(schema.attendanceXAttendanceTypes)
        .where(
          and(
            eq(schema.attendanceXAttendanceTypes.attendanceId, attendance.id),
            inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [
              ATTENDANCE_TYPE_IDS.Q,
              ATTENDANCE_TYPE_IDS.COQ,
            ]),
          ),
        );

      return { success: true };
    }),

  /**
   * Assign Q and Co-Qs for an event instance
   * Replaces existing Q/Co-Q assignments with the provided users.
   * Existing Q/Co-Qs are demoted to regular HC (PAX).
   */
  assignQAndCoQs: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        qUserId: z.coerce.number().optional(),
        coQUserIds: z.array(z.coerce.number()).optional().default([]),
      }),
    )
    .route({
      method: "PUT",
      path: "/assign-q",
      tags: ["attendance"],
      summary: "Assign Q and Co-Qs",
      description:
        "Assign a Q and optional Co-Qs to an event, demoting existing Q/Co-Qs to HC",
    })
    .output(
      z.object({
        success: z.boolean().describe("Always true; a failure throws an error"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const { eventInstanceId, qUserId, coQUserIds } = input;

      await assertEditorOnEventOrg({
        ctx,
        eventInstanceId,
        message: "You are not authorized to assign Q and Co-Qs",
      });

      return ctx.db.transaction(async (tx) => {
        // Get all existing planned attendance for this event
        const existingAttendance = await tx
          .select({
            id: schema.attendance.id,
            userId: schema.attendance.userId,
            attendanceType: schema.attendance.attendanceType,
          })
          .from(schema.attendance)
          .where(
            and(
              eq(schema.attendance.eventInstanceId, eventInstanceId),
              eq(schema.attendance.isPlanned, true),
            ),
          );

        // Existing Q/Co-Q holders
        const existingQCoQAttendanceIds = existingAttendance
          .filter((a) => a.attendanceType !== "pax")
          .map((a) => a.id);

        // Remove all existing Q/Co-Q type assignments
        if (existingQCoQAttendanceIds.length > 0) {
          await tx
            .delete(schema.attendanceXAttendanceTypes)
            .where(
              and(
                inArray(
                  schema.attendanceXAttendanceTypes.attendanceId,
                  existingQCoQAttendanceIds,
                ),
                inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [
                  ATTENDANCE_TYPE_IDS.Q,
                  ATTENDANCE_TYPE_IDS.COQ,
                ]),
              ),
            );
        }

        const assignedUserIds = new Set([
          ...(qUserId ? [qUserId] : []),
          ...coQUserIds.filter((coQUserId) => coQUserId !== qUserId),
        ]);
        const demotedAttendanceIds = existingAttendance
          .filter(
            (attendance) =>
              !assignedUserIds.has(attendance.userId) &&
              attendance.attendanceType !== "pax",
          )
          .map((attendance) => attendance.id);

        if (demotedAttendanceIds.length > 0) {
          await tx
            .insert(schema.attendanceXAttendanceTypes)
            .values(
              demotedAttendanceIds.map((attendanceId) => ({
                attendanceId,
                attendanceTypeId: ATTENDANCE_TYPE_IDS.PAX,
              })),
            )
            .onConflictDoNothing();
        }

        // Helper to ensure user has attendance record and add type
        const ensureAttendanceWithType = async (
          userId: number,
          typeId: number,
        ) => {
          const existing = existingAttendance.find((a) => a.userId === userId);

          if (existing) {
            // Assigned Q/Co-Q attendance should have exactly the role type
            await tx
              .delete(schema.attendanceXAttendanceTypes)
              .where(
                eq(schema.attendanceXAttendanceTypes.attendanceId, existing.id),
              );

            await tx
              .insert(schema.attendanceXAttendanceTypes)
              .values({
                attendanceId: existing.id,
                attendanceTypeId: typeId,
              })
              .onConflictDoNothing();
          } else {
            // Create new attendance with the type
            const [newAttendance] = await tx
              .insert(schema.attendance)
              .values({
                eventInstanceId,
                userId,
                isPlanned: true,
              })
              .returning({ id: schema.attendance.id });

            if (!newAttendance) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Failed to create attendance record",
              });
            }

            await tx.insert(schema.attendanceXAttendanceTypes).values({
              attendanceId: newAttendance.id,
              attendanceTypeId: typeId,
            });
          }
        };

        // Assign Q
        if (qUserId) {
          await ensureAttendanceWithType(qUserId, ATTENDANCE_TYPE_IDS.Q);
        }

        // Assign Co-Qs
        for (const coQUserId of coQUserIds) {
          // Don't assign Co-Q to the Q user
          if (coQUserId !== qUserId) {
            await ensureAttendanceWithType(coQUserId, ATTENDANCE_TYPE_IDS.COQ);
          }
        }

        // Update event instance timestamp to trigger calendar refresh
        await tx
          .update(schema.eventInstances)
          .set({ updated: new Date().toISOString() })
          .where(eq(schema.eventInstances.id, eventInstanceId));

        return { success: true };
      });
    }),
};
