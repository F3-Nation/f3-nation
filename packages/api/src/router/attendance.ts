import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, eq, inArray, schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";

import {
  assertEditorOnEventOrg,
  assertSelfOrEditorOnEventOrg,
  canViewAttendancePii,
  requireEventInstanceOrgId,
} from "../lib/attendance-auth";
import { protectedProcedure } from "../shared";

/**
 * Get attendance type IDs by type name from the database
 */
async function getAttendanceTypeIds(db: AppDb) {
  const types = await db
    .select({
      id: schema.attendanceTypes.id,
      type: schema.attendanceTypes.type,
    })
    .from(schema.attendanceTypes);

  const typeMap = Object.fromEntries(
    types.map((t) => [t.type, t.id]),
  ) as Record<string, number>;

  return {
    PAX: typeMap.PAX ?? 0,
    Q: typeMap.Q ?? 0,
    COQ: typeMap["Co-Q"] ?? 0,
  };
}

/**
 * Attendance Router
 * Manages attendance records for event instances.
 * Supports HC/Q/Co-Q operations for preblasts and backblasts.
 */
export const attendanceRouter = {
  /**
   * Get all attendance records for an event instance.
   * Includes user info and attendance types.
   *
   * Any authenticated user may read HC/Q lists (f3Name, types) for preblast
   * visibility. Attendee email is PII and is only included when the caller has
   * editor (or admin) role on the event's org.
   */
  getForEventInstance: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        // Use transform to properly handle string "false" from query params
        // z.coerce.boolean() treats any non-empty string as true
        isPlanned: z
          .union([z.boolean(), z.string()])
          .optional()
          .default(true)
          .transform((val) => {
            if (typeof val === "boolean") return val;
            if (val === "false" || val === "0") return false;
            return true;
          }),
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
    .handler(async ({ context: ctx, input }) => {
      const orgId = await requireEventInstanceOrgId(
        ctx.db,
        input.eventInstanceId,
      );
      const includePii = await canViewAttendancePii(ctx, orgId);

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
            email: schema.users.email,
          },
          attendanceTypes: sql<{ id: number; type: string }[]>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${schema.attendanceTypes.id},
                'type', ${schema.attendanceTypes.type}
              )
            )
            FILTER (
              WHERE ${schema.attendanceTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
        })
        .from(schema.attendance)
        .leftJoin(schema.users, eq(schema.users.id, schema.attendance.userId))
        .leftJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .leftJoin(
          schema.attendanceTypes,
          eq(
            schema.attendanceTypes.id,
            schema.attendanceXAttendanceTypes.attendanceTypeId,
          ),
        )
        .where(
          and(
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.isPlanned, input.isPlanned),
          ),
        )
        .groupBy(
          schema.attendance.id,
          schema.users.id,
          schema.users.f3Name,
          schema.users.email,
        );

      return {
        attendance: attendanceRecords.map((record) => ({
          ...record,
          user: record.user
            ? {
                id: record.user.id,
                f3Name: record.user.f3Name,
                ...(includePii ? { email: record.user.email } : {}),
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
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to create planned attendance",
      });

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
    .handler(async ({ context: ctx, input }) => {
      const [attendance] = await ctx.db
        .select({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
          eventInstanceId: schema.attendance.eventInstanceId,
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
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to take Q for this event",
      });

      const ATTENDANCE_TYPE_IDS = await getAttendanceTypeIds(ctx.db);

      // Check if there's already a Q for this event
      const existingQ = await ctx.db
        .select({ id: schema.attendance.id, userId: schema.attendance.userId })
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
            eq(schema.attendance.eventInstanceId, input.eventInstanceId),
            eq(schema.attendance.isPlanned, true),
            eq(
              schema.attendanceXAttendanceTypes.attendanceTypeId,
              ATTENDANCE_TYPE_IDS.Q,
            ),
          ),
        );

      if (existingQ.length > 0 && existingQ[0]?.userId !== input.userId) {
        throw new ORPCError("CONFLICT", {
          message: "Event already has a Q assigned",
        });
      }

      // Check if user already has attendance
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
        attendanceId = existingAttendance[0]!.id;

        // Add Q type to existing attendance (keep other types)
        const existingType = await ctx.db
          .select({ id: schema.attendanceXAttendanceTypes.attendanceTypeId })
          .from(schema.attendanceXAttendanceTypes)
          .where(
            and(
              eq(schema.attendanceXAttendanceTypes.attendanceId, attendanceId),
              eq(
                schema.attendanceXAttendanceTypes.attendanceTypeId,
                ATTENDANCE_TYPE_IDS.Q,
              ),
            ),
          );

        if (existingType.length === 0) {
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
    .handler(async ({ context: ctx, input }) => {
      await assertSelfOrEditorOnEventOrg({
        ctx,
        eventInstanceId: input.eventInstanceId,
        targetUserId: input.userId,
        message: "You are not authorized to remove Q status",
      });

      const ATTENDANCE_TYPE_IDS = await getAttendanceTypeIds(ctx.db);

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
    .handler(async ({ context: ctx, input }) => {
      const { eventInstanceId, qUserId, coQUserIds } = input;

      await assertEditorOnEventOrg({
        ctx,
        eventInstanceId,
        message: "You are not authorized to assign Q and Co-Qs",
      });

      const ATTENDANCE_TYPE_IDS = await getAttendanceTypeIds(ctx.db);

      // Get all existing planned attendance for this event
      const existingAttendance = await ctx.db
        .select({
          id: schema.attendance.id,
          userId: schema.attendance.userId,
        })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.eventInstanceId, eventInstanceId),
            eq(schema.attendance.isPlanned, true),
          ),
        );

      // Get existing Q/Co-Q type assignments
      const existingQCoQAssignments = await ctx.db
        .select({
          attendanceId: schema.attendanceXAttendanceTypes.attendanceId,
          attendanceTypeId: schema.attendanceXAttendanceTypes.attendanceTypeId,
        })
        .from(schema.attendanceXAttendanceTypes)
        .where(
          and(
            inArray(
              schema.attendanceXAttendanceTypes.attendanceId,
              existingAttendance.map((a) => a.id),
            ),
            inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [
              ATTENDANCE_TYPE_IDS.Q,
              ATTENDANCE_TYPE_IDS.COQ,
            ]),
          ),
        );

      // Remove all existing Q/Co-Q type assignments
      if (existingQCoQAssignments.length > 0) {
        await ctx.db.delete(schema.attendanceXAttendanceTypes).where(
          and(
            inArray(
              schema.attendanceXAttendanceTypes.attendanceId,
              existingQCoQAssignments.map((a) => a.attendanceId),
            ),
            inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [
              ATTENDANCE_TYPE_IDS.Q,
              ATTENDANCE_TYPE_IDS.COQ,
            ]),
          ),
        );
      }

      // Helper to ensure user has attendance record and add type
      const ensureAttendanceWithType = async (
        userId: number,
        typeId: number,
      ) => {
        const existing = existingAttendance.find((a) => a.userId === userId);

        if (existing) {
          // Add type to existing attendance
          await ctx.db
            .insert(schema.attendanceXAttendanceTypes)
            .values({
              attendanceId: existing.id,
              attendanceTypeId: typeId,
            })
            .onConflictDoNothing();
        } else {
          // Create new attendance with the type
          const [newAttendance] = await ctx.db
            .insert(schema.attendance)
            .values({
              eventInstanceId,
              userId,
              isPlanned: true,
            })
            .returning({ id: schema.attendance.id });

          if (newAttendance) {
            // Add PAX and the specific type
            await ctx.db.insert(schema.attendanceXAttendanceTypes).values([
              {
                attendanceId: newAttendance.id,
                attendanceTypeId: ATTENDANCE_TYPE_IDS.PAX,
              },
              { attendanceId: newAttendance.id, attendanceTypeId: typeId },
            ]);
          }
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
      await ctx.db
        .update(schema.eventInstances)
        .set({ updated: new Date().toISOString() })
        .where(eq(schema.eventInstances.id, eventInstanceId));

      return { success: true };
    }),
};
