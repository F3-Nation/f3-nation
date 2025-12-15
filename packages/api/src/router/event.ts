import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  schema,
  sql,
} from "@acme/db";
import { IsActiveStatus } from "@acme/shared/app/enums";
import { EventInsertSchema } from "@acme/validators";

import { getFullAddress } from "../../../shared/src/app/functions";
import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { editorProcedure, publicProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const eventRouter = {
  all: publicProcedure
    .input(
      z
        .object({
          pageIndex: z.number().optional(),
          pageSize: z.number().optional(),
          searchTerm: z.string().optional(),
          statuses: z.enum(["active", "inactive"]).array().optional(),
          sorting: z
            .array(z.object({ id: z.string(), desc: z.boolean() }))
            .optional(),
          regionIds: z.number().array().optional(),
          aoIds: z.number().array().optional(),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/all",
      tags: ["event"],
      summary: "List all events",
      description:
        "Get a paginated list of workout events with optional filtering and sorting",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const parentOrg = aliasedTable(schema.orgs, "parent_org");
      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;
      const where = and(
        !input?.statuses?.length // no statuses provided, default to active
          ? eq(schema.events.isActive, true)
          : input.statuses.length === IsActiveStatus.length
            ? undefined
            : eq(schema.events.isActive, input.statuses.includes("active")),
        input?.searchTerm
          ? or(
              ilike(schema.events.name, `%${input?.searchTerm}%`),
              ilike(schema.events.description, `%${input?.searchTerm}%`),
            )
          : undefined,
        input?.regionIds?.length
          ? inArray(regionOrg.id, input.regionIds)
          : undefined,
        input?.aoIds?.length ? inArray(parentOrg.id, input.aoIds) : undefined,
      );
      const sortedColumns = input?.sorting?.map((sorting) => {
        const direction = sorting.desc ? desc : asc;
        switch (sorting.id) {
          case "regions":
            return direction(regionOrg.name);
          case "parent":
            return direction(parentOrg.name);
          case "status":
            return direction(schema.events.isActive);
          case "dayOfWeek":
            return direction(schema.events.dayOfWeek);
          case "created":
            return direction(schema.events.created);
          default:
            return direction(schema.events.id);
        }
      }) ?? [desc(schema.events.id)];

      const select = {
        id: schema.events.id,
        name: schema.events.name,
        description: schema.events.description,
        isActive: schema.events.isActive,
        parent: parentOrg.name,
        locationId: schema.events.locationId,
        startDate: schema.events.startDate,
        dayOfWeek: schema.events.dayOfWeek,
        startTime: schema.events.startTime,
        endTime: schema.events.endTime,
        email: schema.events.email,
        created: schema.events.created,
        locationName: schema.locations.name,
        locationAddress: schema.locations.addressStreet,
        locationAddress2: schema.locations.addressStreet2,
        locationCity: schema.locations.addressCity,
        locationState: schema.locations.addressState,
        locationZip: schema.locations.addressZip,
        parents: sql<{ aoId: number; aoName: string }[]>`COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'parentId', ${parentOrg.id}, 
            'parentName', ${parentOrg.name}
          )
        ) 
        FILTER (
          WHERE ${parentOrg.id} IS NOT NULL
        ), 
        '[]'
      )`,
        regions: sql<{ regionId: number; regionName: string }[]>`COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'regionId', ${regionOrg.id}, 
              'regionName', ${regionOrg.name}
            )
          ) 
          FILTER (
            WHERE ${regionOrg.id} IS NOT NULL
          ), 
          '[]'
        )`,
      };

      const [eventCount] = await ctx.db
        .select({ count: count() })
        .from(schema.events)
        .innerJoin(
          schema.locations,
          eq(schema.locations.id, schema.events.locationId),
        )
        .leftJoin(
          parentOrg,
          and(
            eq(parentOrg.orgType, "ao"),
            eq(parentOrg.id, schema.events.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            or(
              eq(regionOrg.id, schema.locations.orgId),
              eq(regionOrg.id, schema.events.orgId),
              eq(regionOrg.id, parentOrg.parentId),
            ),
          ),
        )
        .where(where);

      const query = ctx.db
        .select(select)
        .from(schema.events)
        .innerJoin(
          schema.locations,
          eq(schema.locations.id, schema.events.locationId),
        )
        .leftJoin(
          parentOrg,
          and(
            eq(parentOrg.orgType, "ao"),
            eq(parentOrg.id, schema.events.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            or(
              eq(regionOrg.id, schema.locations.orgId),
              eq(regionOrg.id, schema.events.orgId),
              eq(regionOrg.id, parentOrg.parentId),
            ),
          ),
        )
        .groupBy(
          schema.events.id,
          parentOrg.id,
          regionOrg.id,
          schema.locations.name,
          schema.locations.addressStreet,
          schema.locations.addressStreet2,
          schema.locations.addressCity,
          schema.locations.addressState,
          schema.locations.addressZip,
        )
        .where(where);

      const events = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query;

      const eventsWithLocation = events.map((event) => ({
        ...event,
        location: getFullAddress(event),
      }));

      return { events: eventsWithLocation, totalCount: eventCount?.count ?? 0 };
    }),
  byId: publicProcedure
    .input(z.object({ id: z.number() }))
    .route({
      method: "GET",
      path: "/by-id",
      tags: ["event"],
      summary: "Get event by ID",
      description: "Retrieve detailed information about a specific event",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const [event] = await ctx.db
        .select({
          id: schema.events.id,
          name: schema.events.name,
          description: schema.events.description,
          isActive: schema.events.isActive,
          location: aoOrg.name,
          locationId: schema.events.locationId,
          startDate: schema.events.startDate,
          dayOfWeek: schema.events.dayOfWeek,
          startTime: schema.events.startTime,
          endTime: schema.events.endTime,
          email: schema.events.email,
          highlight: schema.events.highlight,
          created: schema.events.created,
          meta: schema.events.meta,
          aos: sql<{ aoId: number; aoName: string }[]>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'aoId', ${aoOrg.id}, 
                'aoName', ${aoOrg.name}
              )
            ) 
            FILTER (
              WHERE ${aoOrg.id} IS NOT NULL
            ), 
            '[]'
          )`,
          regions: sql<{ regionId: number; regionName: string }[]>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'regionId', ${regionOrg.id}, 
                'regionName', ${regionOrg.name}
              )
            ) 
            FILTER (
              WHERE ${regionOrg.id} IS NOT NULL
            ), 
            '[]'
          )`,
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
        })
        .from(schema.events)
        .leftJoin(
          schema.locations,
          eq(schema.locations.id, schema.events.locationId),
        )
        .leftJoin(
          aoOrg,
          and(eq(aoOrg.orgType, "ao"), eq(aoOrg.id, schema.events.orgId)),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            or(
              eq(regionOrg.id, schema.locations.orgId),
              eq(regionOrg.id, schema.events.orgId),
              eq(regionOrg.id, aoOrg.parentId),
            ),
          ),
        )
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .where(eq(schema.events.id, input.id))
        .groupBy(schema.events.id, aoOrg.id, regionOrg.id);

      return event;
    }),
  crupdate: editorProcedure
    .input(EventInsertSchema.partial({ id: true }))
    .route({
      method: "POST",
      path: "/crupdate",
      tags: ["event"],
      summary: "Create or update event",
      description: "Create a new event or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingEvent] = input.id
        ? await ctx.db
            .select()
            .from(schema.events)
            .where(eq(schema.events.id, input.id))
        : [];

      const orgIdToCheck = input.aoId ?? input.regionId;
      if (!orgIdToCheck) {
        throw new ORPCError("BAD_REQUEST", {
          message: "AO ID or Region ID is required",
        });
      }
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: existingEvent?.orgId ?? orgIdToCheck,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to update this Event",
        });
      }

      const { eventTypeIds, meta, ...eventData } = input;
      const eventToUpdate: typeof schema.events.$inferInsert = {
        ...eventData,
        orgId: input.aoId,
        meta: meta
          ? {
              ...meta,
              mapSeed: meta.mapSeed as boolean | undefined,
              eventTypeId: undefined, // Remove eventTypeId from meta since we handle it in join table
            }
          : null,
      };

      const [result] = await ctx.db
        .insert(schema.events)
        .values(eventToUpdate)
        .onConflictDoUpdate({
          target: [schema.events.id],
          set: eventToUpdate,
        })
        .returning();

      if (!result) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create/update event",
        });
      }

      // Handle event type in join table
      if (eventTypeIds) {
        await ctx.db
          .delete(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, result.id));

        await ctx.db.insert(schema.eventsXEventTypes).values(
          eventTypeIds.map((eventTypeId) => ({
            eventId: result.id,
            eventTypeId,
          })),
        );
      }

      return result;
    }),
  eventIdToRegionNameLookup: publicProcedure
    .route({
      method: "GET",
      path: "/event-id-to-region-name-lookup",
      tags: ["event"],
      summary: "Event to region lookup",
      description: "Get a mapping of event IDs to their region names",
    })
    .handler(async ({ context: ctx }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const parentOrg = aliasedTable(schema.orgs, "parent_org");
      const result = await ctx.db
        .select({
          eventId: schema.events.id,
          regionName: regionOrg.name,
        })
        .from(schema.events)
        .leftJoin(parentOrg, eq(schema.events.orgId, parentOrg.id))
        .leftJoin(
          regionOrg,
          or(
            and(
              eq(schema.events.orgId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
            and(
              eq(parentOrg.orgType, "ao"),
              eq(parentOrg.parentId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
          ),
        )
        .groupBy(schema.events.id, regionOrg.id);

      const lookup = result.reduce(
        (acc, curr) => {
          if (curr.regionName) {
            acc[curr.eventId] = curr.regionName;
          }
          return acc;
        },
        {} as Record<number, string>,
      );

      return lookup;
    }),
  delete: editorProcedure
    .input(z.object({ id: z.number() }))
    .route({
      method: "DELETE",
      path: "/delete",
      tags: ["event"],
      summary: "Delete event",
      description: "Soft delete an event by marking it as inactive",
    })
    .handler(async ({ context: ctx, input }) => {
      const [event] = await ctx.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, input.id));
      if (!event) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event not found",
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
          message: "You are not authorized to delete this Event",
        });
      }
      await ctx.db
        .update(schema.events)
        .set({ isActive: false })
        .where(
          and(eq(schema.events.id, input.id), eq(schema.events.isActive, true)),
        );

      return { eventId: input.id };
    }),
};
