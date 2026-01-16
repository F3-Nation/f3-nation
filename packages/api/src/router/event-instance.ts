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
 * Event instances are non-recurring events (events without recurrence patterns)
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
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["event-instance"],
      summary: "List all event instances",
      description:
        "Get a paginated list of single event instances (non-recurring events)",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const limit = input?.pageSize ?? 40;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      // Event instances are events without recurrence patterns (single events)
      const where = and(
        // Only get non-recurring events (instances)
        isNull(schema.events.recurrencePattern),
        // Active status filter
        input?.statuses?.includes("inactive")
          ? undefined
          : eq(schema.events.isActive, true),
        // Search filter
        input?.searchTerm
          ? or(
              ilike(schema.events.name, `%${input.searchTerm}%`),
              ilike(schema.events.description, `%${input.searchTerm}%`),
            )
          : undefined,
        // Region filter
        input?.regionOrgId ? eq(regionOrg.id, input.regionOrgId) : undefined,
        // AO filter
        input?.aoOrgId ? eq(aoOrg.id, input.aoOrgId) : undefined,
        // Start date filter
        input?.startDate
          ? gte(schema.events.startDate, input.startDate)
          : undefined,
      );

      const select = {
        id: schema.events.id,
        name: schema.events.name,
        description: schema.events.description,
        isActive: schema.events.isActive,
        locationId: schema.events.locationId,
        orgId: schema.events.orgId,
        startDate: schema.events.startDate,
        startTime: schema.events.startTime,
        endTime: schema.events.endTime,
        highlight: schema.events.highlight,
        meta: schema.events.meta,
        isPrivate: schema.events.isPrivate,
      };

      const [instanceCount] = await ctx.db
        .select({ count: count() })
        .from(schema.events)
        .leftJoin(
          aoOrg,
          and(eq(aoOrg.orgType, "ao"), eq(aoOrg.id, schema.events.orgId)),
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
            return direction(schema.events.startDate);
          case "startTime":
            return direction(schema.events.startTime);
          case "name":
            return direction(schema.events.name);
          default:
            return direction(schema.events.startDate);
        }
      }) ?? [asc(schema.events.startDate), asc(schema.events.startTime)];

      const query = ctx.db
        .select(select)
        .from(schema.events)
        .leftJoin(
          aoOrg,
          and(eq(aoOrg.orgType, "ao"), eq(aoOrg.id, schema.events.orgId)),
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
          id: schema.events.id,
          name: schema.events.name,
          description: schema.events.description,
          isActive: schema.events.isActive,
          locationId: schema.events.locationId,
          orgId: schema.events.orgId,
          startDate: schema.events.startDate,
          endDate: schema.events.endDate,
          startTime: schema.events.startTime,
          endTime: schema.events.endTime,
          highlight: schema.events.highlight,
          meta: schema.events.meta,
          isPrivate: schema.events.isPrivate,
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
        .from(schema.events)
        .leftJoin(
          aoOrg,
          and(eq(aoOrg.orgType, "ao"), eq(aoOrg.id, schema.events.orgId)),
        )
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .leftJoin(
          schema.eventTagsXEvents,
          eq(schema.eventTagsXEvents.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTags,
          eq(schema.eventTags.id, schema.eventTagsXEvents.eventTagId),
        )
        .where(eq(schema.events.id, input.id))
        .groupBy(schema.events.id, aoOrg.id);

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
      description: "Create a new single event or update an existing one",
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

      // Create the event (without recurrence pattern = single instance)
      const [result] = await ctx.db
        .insert(schema.events)
        .values({
          ...eventData,
          name,
          recurrencePattern: null, // No recurrence for instances
          recurrenceInterval: null,
          indexWithinInterval: null,
          dayOfWeek: null,
        })
        .onConflictDoUpdate({
          target: [schema.events.id],
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
          .delete(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, result.id));

        await ctx.db.insert(schema.eventsXEventTypes).values({
          eventId: result.id,
          eventTypeId,
        });
      }

      // Handle event tag in join table
      if (eventTagId) {
        await ctx.db
          .delete(schema.eventTagsXEvents)
          .where(eq(schema.eventTagsXEvents.eventId, result.id));

        await ctx.db.insert(schema.eventTagsXEvents).values({
          eventId: result.id,
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
      description: "Delete a single event instance",
    })
    .handler(async ({ context: ctx, input }) => {
      const [event] = await ctx.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, input.id));

      if (!event) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event instance not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: event.orgId,
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
      await ctx.db.delete(schema.events).where(eq(schema.events.id, input.id));

      return { success: true };
    }),
};
