import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { arrayOrSingle } from "@acme/shared/app/functions";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

/**
 * Event Instance Router
 * Event instances are individual event occurrences stored in the event_instances table.
 * They may or may not be linked to a series (recurring event) via seriesId.
 */
export const eventInstanceRouter = {
  all: protectedProcedure
    .input(
      z
        .object({
          pageIndex: z.coerce.number().optional(),
          pageSize: z.coerce.number().optional(),
          searchTerm: z.string().optional(),
          statuses: arrayOrSingle(z.enum(["active", "inactive"])).optional(),
          sorting: z
            .array(z.object({ id: z.string(), desc: z.coerce.boolean() }))
            .optional(),
          regionOrgId: z.coerce.number().optional(),
          aoOrgId: z.coerce.number().optional(),
          startDate: z.string().optional(),
          seriesId: z.coerce.number().optional(),
          onlyStandalone: z.coerce.boolean().optional(), // Only instances without a series
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["event-instance"],
      summary: "List all event instances",
      description:
        "Get a paginated list of event instances (individual occurrences)",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const limit = input?.pageSize ?? 40;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      const where = and(
        // Active status filter
        input?.statuses?.includes("inactive")
          ? undefined
          : eq(schema.eventInstances.isActive, true),
        // Search filter
        input?.searchTerm
          ? or(
              ilike(schema.eventInstances.name, `%${input.searchTerm}%`),
              ilike(schema.eventInstances.description, `%${input.searchTerm}%`),
            )
          : undefined,
        // Region filter (through AO's parent)
        input?.regionOrgId ? eq(regionOrg.id, input.regionOrgId) : undefined,
        // AO filter
        input?.aoOrgId ? eq(aoOrg.id, input.aoOrgId) : undefined,
        // Start date filter
        input?.startDate
          ? gte(schema.eventInstances.startDate, input.startDate)
          : undefined,
        // Series filter
        input?.seriesId
          ? eq(schema.eventInstances.seriesId, input.seriesId)
          : undefined,
        // Standalone instances only (no series link)
        input?.onlyStandalone
          ? isNull(schema.eventInstances.seriesId)
          : undefined,
      );

      const select = {
        id: schema.eventInstances.id,
        name: schema.eventInstances.name,
        description: schema.eventInstances.description,
        isActive: schema.eventInstances.isActive,
        locationId: schema.eventInstances.locationId,
        orgId: schema.eventInstances.orgId,
        seriesId: schema.eventInstances.seriesId,
        startDate: schema.eventInstances.startDate,
        endDate: schema.eventInstances.endDate,
        startTime: schema.eventInstances.startTime,
        endTime: schema.eventInstances.endTime,
        highlight: schema.eventInstances.highlight,
        meta: schema.eventInstances.meta,
        isPrivate: schema.eventInstances.isPrivate,
        paxCount: schema.eventInstances.paxCount,
        fngCount: schema.eventInstances.fngCount,
      };

      const [instanceCount] = await ctx.db
        .select({ count: count() })
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            eq(regionOrg.id, aoOrg.parentId),
          ),
        )
        .where(where);

      const sortedColumns = input?.sorting?.map((sorting) => {
        const direction = sorting.desc ? desc : asc;
        switch (sorting.id) {
          case "startDate":
            return direction(schema.eventInstances.startDate);
          case "startTime":
            return direction(schema.eventInstances.startTime);
          case "name":
            return direction(schema.eventInstances.name);
          default:
            return direction(schema.eventInstances.startDate);
        }
      }) ?? [
        asc(schema.eventInstances.startDate),
        asc(schema.eventInstances.startTime),
      ];

      const query = ctx.db
        .select(select)
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            eq(regionOrg.id, aoOrg.parentId),
          ),
        )
        .where(where);

      const instances = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns).limit(limit);

      return {
        eventInstances: instances,
        totalCount: instanceCount?.count ?? 0,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["event-instance"],
      summary: "Get event instance by ID",
      description:
        "Retrieve detailed information about a specific event instance",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      const [instance] = await ctx.db
        .select({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          description: schema.eventInstances.description,
          isActive: schema.eventInstances.isActive,
          locationId: schema.eventInstances.locationId,
          orgId: schema.eventInstances.orgId,
          seriesId: schema.eventInstances.seriesId,
          startDate: schema.eventInstances.startDate,
          endDate: schema.eventInstances.endDate,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
          highlight: schema.eventInstances.highlight,
          meta: schema.eventInstances.meta,
          isPrivate: schema.eventInstances.isPrivate,
          paxCount: schema.eventInstances.paxCount,
          fngCount: schema.eventInstances.fngCount,
          preblast: schema.eventInstances.preblast,
          backblast: schema.eventInstances.backblast,
          eventTypes: sql<
            { eventTypeId: number; eventTypeName: string }[]
          >`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'eventTypeId', ${schema.eventTypes.id},
                'eventTypeName', ${schema.eventTypes.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
          eventTags: sql<
            { eventTagId: number; eventTagName: string }[]
          >`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'eventTagId', ${schema.eventTags.id},
                'eventTagName', ${schema.eventTags.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTags.id} IS NOT NULL
            ),
            '[]'
          )`,
        })
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          schema.eventInstancesXEventTypes,
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            schema.eventInstances.id,
          ),
        )
        .leftJoin(
          schema.eventTypes,
          eq(
            schema.eventTypes.id,
            schema.eventInstancesXEventTypes.eventTypeId,
          ),
        )
        .leftJoin(
          schema.eventTagsXEventInstances,
          eq(
            schema.eventTagsXEventInstances.eventInstanceId,
            schema.eventInstances.id,
          ),
        )
        .leftJoin(
          schema.eventTags,
          eq(schema.eventTags.id, schema.eventTagsXEventInstances.eventTagId),
        )
        .where(eq(schema.eventInstances.id, input.id))
        .groupBy(schema.eventInstances.id, aoOrg.id);

      return instance ?? null;
    }),

  crupdate: editorProcedure
    .input(
      z.object({
        id: z.coerce.number().optional(),
        name: z.string().optional(),
        description: z.string().nullish(),
        isActive: z.boolean().optional().default(true),
        locationId: z.coerce.number().nullish(),
        orgId: z.coerce.number(),
        seriesId: z.coerce.number().nullish(), // Link to series if this is a series instance
        startDate: z.string(),
        endDate: z.string().nullish(),
        startTime: z.string().nullish(),
        endTime: z.string().nullish(),
        highlight: z.boolean().optional().default(false),
        meta: z.record(z.unknown()).nullish(),
        isPrivate: z.boolean().optional().default(false),
        eventTypeId: z.coerce.number().optional(),
        eventTagId: z.coerce.number().optional(),
      }),
    )
    .route({
      method: "POST",
      path: "/",
      tags: ["event-instance"],
      summary: "Create or update event instance",
      description: "Create a new event instance or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      // Check permissions
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to create/update event instances",
        });
      }

      // Generate a default name if not provided
      let name = input.name;
      if (!name) {
        // Get AO name
        const [ao] = await ctx.db
          .select({ name: schema.orgs.name })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, input.orgId));
        const aoName = ao?.name ?? "Workout";

        // Get event type name if provided
        let eventTypeName = "Event";
        if (input.eventTypeId) {
          const [eventType] = await ctx.db
            .select({ name: schema.eventTypes.name })
            .from(schema.eventTypes)
            .where(eq(schema.eventTypes.id, input.eventTypeId));
          eventTypeName = eventType?.name ?? "Event";
        }

        name = `${aoName} - ${eventTypeName}`;
      }

      const { eventTypeId, eventTagId, name: _inputName, ...eventData } = input;

      // Create or update the event instance
      const [result] = await ctx.db
        .insert(schema.eventInstances)
        .values({
          ...eventData,
          name,
        })
        .onConflictDoUpdate({
          target: [schema.eventInstances.id],
          set: { ...eventData, name },
        })
        .returning();

      if (!result) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create/update event instance",
        });
      }

      // Handle event type in join table
      if (eventTypeId) {
        await ctx.db
          .delete(schema.eventInstancesXEventTypes)
          .where(
            eq(schema.eventInstancesXEventTypes.eventInstanceId, result.id),
          );

        await ctx.db.insert(schema.eventInstancesXEventTypes).values({
          eventInstanceId: result.id,
          eventTypeId,
        });
      }

      // Handle event tag in join table
      if (eventTagId) {
        await ctx.db
          .delete(schema.eventTagsXEventInstances)
          .where(
            eq(schema.eventTagsXEventInstances.eventInstanceId, result.id),
          );

        await ctx.db.insert(schema.eventTagsXEventInstances).values({
          eventInstanceId: result.id,
          eventTagId,
        });
      }

      return result;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "DELETE",
      path: "/id/{id}",
      tags: ["event-instance"],
      summary: "Delete event instance",
      description: "Delete an event instance (hard delete)",
    })
    .handler(async ({ context: ctx, input }) => {
      const [instance] = await ctx.db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, input.id));

      if (!instance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event instance not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: instance.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this event instance",
        });
      }

      // Hard delete for event instances
      await ctx.db
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, input.id));

      return { success: true };
    }),

  /**
   * Get upcoming events where the user is Q or Co-Q
   * Used for preblast selection menu
   */
  getUpcomingQs: protectedProcedure
    .input(
      z.object({
        userId: z.coerce.number(),
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted preblast (preblast_ts IS NULL) */
        notPostedOnly: z.boolean().optional().default(true),
      }),
    )
    .route({
      method: "GET",
      path: "/upcoming-qs",
      tags: ["event-instance"],
      summary: "Get upcoming events where user is Q/Co-Q",
      description:
        "Get events where the user has Q or Co-Q attendance for preblast creation",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Attendance type IDs: 2 = Q, 3 = Co-Q
      const qAttendanceTypeIds = [2, 3];

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or later
        gte(schema.eventInstances.startDate, today),
        // User has planned attendance
        eq(schema.attendance.userId, input.userId),
        eq(schema.attendance.isPlanned, true),
        // Attendance is Q or Co-Q type
        inArray(
          schema.attendanceXAttendanceTypes.attendanceTypeId,
          qAttendanceTypeIds,
        ),
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
      ];

      // Add preblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.preblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          preblastTs: schema.eventInstances.preblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .innerJoin(
          schema.attendance,
          eq(schema.attendance.eventInstanceId, schema.eventInstances.id),
        )
        .innerJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .where(and(...whereConditions))
        .orderBy(
          asc(schema.eventInstances.startDate),
          asc(schema.eventInstances.startTime),
        );

      return { eventInstances: instances };
    }),

  /**
   * Get past events where the user is Q or Co-Q
   * Used for backblast selection menu
   */
  getPastQs: protectedProcedure
    .input(
      z.object({
        userId: z.coerce.number(),
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted backblast (backblast_ts IS NULL) */
        notPostedOnly: z.boolean().optional().default(true),
      }),
    )
    .route({
      method: "GET",
      path: "/past-qs",
      tags: ["event-instance"],
      summary: "Get past events where user is Q/Co-Q",
      description:
        "Get past events where the user has Q or Co-Q attendance for backblast creation",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Attendance type IDs: 2 = Q, 3 = Co-Q
      const qAttendanceTypeIds = [2, 3];

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or earlier (past events)
        sql`${schema.eventInstances.startDate} <= ${today}`,
        // User has planned attendance
        eq(schema.attendance.userId, input.userId),
        eq(schema.attendance.isPlanned, true),
        // Attendance is Q or Co-Q type
        inArray(
          schema.attendanceXAttendanceTypes.attendanceTypeId,
          qAttendanceTypeIds,
        ),
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
      ];

      // Add backblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.backblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          backblastTs: schema.eventInstances.backblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .innerJoin(
          schema.attendance,
          eq(schema.attendance.eventInstanceId, schema.eventInstances.id),
        )
        .innerJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .where(and(...whereConditions))
        .orderBy(
          desc(schema.eventInstances.startDate),
          desc(schema.eventInstances.startTime),
        );

      return { eventInstances: instances };
    }),

  /**
   * Get past events without any Q or Co-Q assigned
   * Used for backblast selection menu "unclaimed events" section
   */
  getEventsWithoutQ: protectedProcedure
    .input(
      z.object({
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted backblast (backblast_ts IS NULL) */
        notPostedOnly: z.boolean().optional().default(true),
        /** Maximum number of events to return */
        limit: z.coerce.number().optional().default(20),
      }),
    )
    .route({
      method: "GET",
      path: "/without-q",
      tags: ["event-instance"],
      summary: "Get past events without Q assigned",
      description: "Get past events that have no Q or Co-Q attendance assigned",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Subquery to find event instances that DO have Q or Co-Q attendance
      const eventsWithQ = ctx.db
        .selectDistinct({ eventInstanceId: schema.attendance.eventInstanceId })
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
            eq(schema.attendance.isPlanned, true),
            inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [2, 3]),
          ),
        );

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or earlier (past events)
        sql`${schema.eventInstances.startDate} <= ${today}`,
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
        // Exclude events that have Q or Co-Q
        sql`${schema.eventInstances.id} NOT IN (${eventsWithQ})`,
      ];

      // Add backblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.backblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          backblastTs: schema.eventInstances.backblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .where(and(...whereConditions))
        .orderBy(
          desc(schema.eventInstances.startDate),
          desc(schema.eventInstances.startTime),
        )
        .limit(input.limit);

      return { eventInstances: instances };
    }),
};
