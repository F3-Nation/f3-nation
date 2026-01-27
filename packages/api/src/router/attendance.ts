import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, eq, inArray, schema, sql } from "@acme/db";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { protectedProcedure } from "../shared";

/**
 * Attendance type IDs (from attendance_types table)
 */
const ATTENDANCE_TYPE_IDS = {
  PAX: 1,
  Q: 2,
  COQ: 3,
} as const;

/**
 * Attendance Router
 * Manages attendance records for event instances.
 * Used by the slackbot for HC/Q/Co-Q operations on preblasts.
 */
export const attendanceRouter = {
  /**
   * Get all attendance records for an event instance
   * Includes user info and attendance types
   */
  getForEventInstance: protectedProcedure
    .input(
      z.object({
        eventInstanceId: z.coerce.number(),
        isPlanned: z.boolean().optional().default(true),
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

      // Get slack user links for each attendee
      const userIds = attendanceRecords.map((r) => r.userId);
      const slackUserLinks =
        userIds.length > 0
          ? await ctx.db
              .select({
                userId: schema.slackUsers.userId,
                slackId: schema.slackUsers.slackId,
                slackTeamId: schema.slackUsers.slackTeamId,
              })
              .from(schema.slackUsers)
              .where(inArray(schema.slackUsers.userId, userIds))
          : [];

      // Attach slack users to attendance records
      const attendanceWithSlack = attendanceRecords.map((record) => ({
        ...record,
        slackUsers: slackUserLinks.filter(
          (s) => s.userId === record.userId && s.userId !== null,
        ),
      }));

      return { attendance: attendanceWithSlack };
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
      // Verify event instance exists and get orgId
      const [eventInstance] = await ctx.db
        .select({ orgId: schema.eventInstances.orgId })
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, input.eventInstanceId));

      if (!eventInstance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event instance not found",
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
      // Verify attendance exists
      const [attendance] = await ctx.db
        .select({ id: schema.attendance.id })
        .from(schema.attendance)
        .where(eq(schema.attendance.id, input.attendanceId));

      if (!attendance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Attendance record not found",
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
    .handler(async ({ context: ctx, input }) => {
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
};
