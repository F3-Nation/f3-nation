import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import {
  aliasedTable,
  and,
  asc,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  or,
  schema,
  sql,
} from "@acme/db";
import type { AppDb } from "@acme/db/client";
import {
  DayOfWeek,
  EventCadence,
  EventCategory,
  IsActiveStatus,
} from "@acme/shared/app/enums";
import { arrayOrSingle, getFullAddress } from "@acme/shared/app/functions";
import { EventInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { logError } from "../logger";
import { notifyMapDataChange } from "../lib/webhook-events";
import type { Context } from "../shared";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

// Shared filter schema for events (used by both `all` and `count` endpoints)
const eventFilterSchema = z.object({
  searchTerm: z
    .string()
    .optional()
    .describe(
      "Search events by name or description. Case-insensitive partial matching.",
    ),
  statuses: arrayOrSingle(z.enum(["active", "inactive"]))
    .optional()
    .describe(
      "Filter events by status. Matches events with ANY of the given statuses.",
    ),
  eventTypeNames: arrayOrSingle(z.string())
    .optional()
    .describe(
      "Filter events by event type name(s). Matches events with ANY of the given type names.",
    ),
  eventCategories: arrayOrSingle(z.enum(EventCategory))
    .optional()
    .describe(
      "Filter events by event category(ies). Matches events with ANY of the given categories.",
    ),
  regionIds: arrayOrSingle(z.coerce.number())
    .optional()
    .describe(
      "Filter events by region ID(s). Returns events in ANY of the specified regions.",
    ),
  aoIds: arrayOrSingle(z.coerce.number())
    .optional()
    .describe(
      "Filter events by area organization (AO) ID(s). Returns events in ANY of the specified AOs.",
    ),
  onlyMine: z.coerce
    .boolean()
    .optional()
    .describe(
      "If true, only return events in organizations where the requester has editor or admin role.",
    ),
});

type EventFilterInput = z.infer<typeof eventFilterSchema>;

// Extended schema with pagination and sorting for the `all` endpoint
const eventAllInputSchema = eventFilterSchema
  .extend({
    pageIndex: z.coerce
      .number()
      .optional()
      .describe("Zero-based page index for pagination. Defaults to 0."),
    pageSize: z.coerce
      .number()
      .optional()
      .describe("Number of events per page. Defaults to 10."),
    sorting: z
      .array(z.object({ id: z.string(), desc: z.coerce.boolean() }))
      .optional()
      .describe(
        "Sort results by field(s). Format: [{ id: 'fieldName', desc: true/false }]. Available fields: regions, parent, status, dayOfWeek, created.",
      ),
  })
  .optional();

// Aliased tables used across event queries
const regionOrg = aliasedTable(schema.orgs, "region_org");
const parentOrg = aliasedTable(schema.orgs, "parent_org");

/**
 * Resolves editable org IDs for "onlyMine" filter
 * Returns empty result indicator if user has no access
 */
async function resolveEditableOrgIds(params: {
  ctx: Context;
  onlyMine?: boolean;
}): Promise<{ editableOrgIds: number[]; isNationAdmin: boolean } | null> {
  const { ctx, onlyMine } = params;

  if (!onlyMine) {
    return { editableOrgIds: [], isNationAdmin: false };
  }

  const result = await getEditableOrgIdsForUser(ctx);
  const { editableOrgs, isNationAdmin } = result;

  if (!isNationAdmin && editableOrgs.length > 0) {
    const editableOrgIdsList = editableOrgs.map((org) => org.id);
    const editableOrgIds = await getDescendantOrgIds(
      ctx.db,
      editableOrgIdsList,
    );
    return { editableOrgIds, isNationAdmin };
  }

  // If user has no editable orgs and is not a nation admin, return null to indicate empty result
  if (editableOrgs.length === 0 && !isNationAdmin) {
    return null;
  }

  return { editableOrgIds: [], isNationAdmin };
}

/**
 * Builds the WHERE clause for event queries based on filter input
 */
function buildEventWhereClause(params: {
  input?: EventFilterInput;
  editableOrgIds: number[];
  isNationAdmin: boolean;
}): SQL | undefined {
  const { input, editableOrgIds, isNationAdmin } = params;

  return and(
    !input?.statuses?.length // no statuses provided, default to active
      ? eq(schema.events.isActive, true)
      : input.statuses.length === IsActiveStatus.length
        ? undefined
        : eq(schema.events.isActive, input.statuses.includes("active")),
    input?.searchTerm
      ? or(
          ilike(schema.events.name, `%${input.searchTerm}%`),
          ilike(schema.events.description, `%${input.searchTerm}%`),
        )
      : undefined,
    input?.eventTypeNames?.length
      ? inArray(schema.eventTypes.name, input.eventTypeNames)
      : undefined,
    input?.eventCategories?.length
      ? inArray(schema.eventTypes.eventCategory, input.eventCategories)
      : undefined,
    input?.regionIds?.length
      ? inArray(regionOrg.id, input.regionIds)
      : undefined,
    input?.aoIds?.length ? inArray(parentOrg.id, input.aoIds) : undefined,
    // Filter by editable org IDs if onlyMine is true and not a nation admin
    input?.onlyMine && !isNationAdmin && editableOrgIds.length > 0
      ? or(
          inArray(regionOrg.id, editableOrgIds),
          inArray(parentOrg.id, editableOrgIds),
        )
      : undefined,
  );
}

/**
 * Builds the base query with all required joins for event queries
 */
function buildEventBaseQuery(params: { db: AppDb; where: SQL | undefined }) {
  const { db, where } = params;

  return (
    db
      .select({ count: countDistinct(schema.events.id) })
      .from(schema.events)
      // Must be a LEFT JOIN so events without a location still appear in admin lists.
      .leftJoin(
        schema.locations,
        eq(schema.locations.id, schema.events.locationId),
      )
      .leftJoin(
        parentOrg,
        and(eq(parentOrg.orgType, "ao"), eq(parentOrg.id, schema.events.orgId)),
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
      .leftJoin(
        schema.eventsXEventTypes,
        eq(schema.eventsXEventTypes.eventId, schema.events.id),
      )
      .leftJoin(
        schema.eventTypes,
        eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
      )
      .where(where)
  );
}

/**
 * Executes a count query for events with the given filters
 */
async function getEventCount(params: {
  db: AppDb;
  where: SQL | undefined;
}): Promise<number> {
  const { db, where } = params;

  const [eventCount] = await buildEventBaseQuery({ db, where });

  return eventCount?.count ?? 0;
}

export const eventRouter = {
  all: protectedProcedure
    .input(eventAllInputSchema)
    .route({
      method: "GET",
      path: "/",
      tags: ["event"],
      summary: "List all events",
      description:
        "Get a paginated list of workout events with optional filtering by event type, category, region, and other criteria. Supports searching, sorting, and pagination.",
    })
    .output(
      z.object({
        events: z.array(
          z.object({
            id: z.number().describe("Event ID"),
            name: z.string().describe("Event name"),
            description: z.string().nullable().describe("Event description"),
            isActive: z.boolean().describe("Whether the event is active"),
            isPrivate: z.boolean().describe("Whether the event is private"),
            parent: z.string().nullable().describe("Parent organization name"),
            locationId: z.number().nullable().describe("Location ID"),
            startDate: z.string().nullable().describe("Event start date"),
            dayOfWeek: z
              .enum(DayOfWeek)
              .nullable()
              .describe("Event day of week"),
            startTime: z.string().nullable().describe("Event start time"),
            endTime: z.string().nullable().describe("Event end time"),
            email: z.string().nullable().describe("Event email"),
            created: z.string().describe("Event creation date"),
            locationName: z.string().nullable().describe("Location name"),
            locationAddress: z.string().nullable().describe("Location address"),
            locationAddress2: z
              .string()
              .nullable()
              .describe("Location address 2"),
            locationCity: z.string().nullable().describe("Location city"),
            locationState: z.string().nullable().describe("Location state"),
            locationZip: z.string().nullable().describe("Location zip"),
            parents: z
              .array(
                z.object({
                  parentId: z.number().describe("Parent organization ID"),
                  parentName: z.string().describe("Parent organization name"),
                }),
              )
              .describe("Parent organizations"),
            regions: z
              .array(
                z.object({
                  regionId: z.number().describe("Region ID"),
                  regionName: z.string().describe("Region name"),
                }),
              )
              .describe("Regions"),
            eventTypes: z
              .array(
                z.object({
                  eventTypeId: z.number().describe("Event type ID"),
                  eventTypeName: z.string().describe("Event type name"),
                  eventCategory: z
                    .enum(EventCategory)
                    .describe("Event category"),
                }),
              )
              .describe("Event types"),
            location: z.string().nullable().describe("Location"),
          }),
        ),
        totalCount: z.number().describe("Total number of events"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      // Resolve editable org IDs for "onlyMine" filter
      const editableResult = await resolveEditableOrgIds({
        ctx,
        onlyMine: input?.onlyMine,
      });

      // If user has no access, return empty result
      if (editableResult === null) {
        return { events: [], totalCount: 0 };
      }

      const { editableOrgIds, isNationAdmin } = editableResult;

      const where = buildEventWhereClause({
        input,
        editableOrgIds,
        isNationAdmin,
      });

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
        isPrivate: schema.events.isPrivate,
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
        parents: sql<{ parentId: number; parentName: string }[]>`COALESCE(
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
        eventTypes: sql<
          {
            eventTypeId: number;
            eventTypeName: string;
            eventCategory: EventCategory;
          }[]
        >`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'eventTypeId', ${schema.eventTypes.id},
                'eventTypeName', ${schema.eventTypes.name},
                'eventCategory', ${schema.eventTypes.eventCategory}
              )
            )
            FILTER (
              WHERE ${schema.eventTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
      };

      const totalCount = await getEventCount({ db: ctx.db, where });

      // Build the full query with select, joins, and groupBy
      const query = ctx.db
        .select(select)
        .from(schema.events)
        // Must be a LEFT JOIN so events without a location still appear in admin lists.
        .leftJoin(
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
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .where(where)
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
        );

      const events = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      const eventsWithLocation = events.map((event) => ({
        ...event,
        location: getFullAddress(event),
      }));

      return { events: eventsWithLocation, totalCount };
    }),
  count: protectedProcedure
    .input(eventFilterSchema.optional())
    .route({
      method: "GET",
      path: "/count",
      tags: ["event"],
      summary: "Count events",
      description:
        "Get the total count of events matching the given filters. Useful for determining pagination requirements.",
    })
    .output(
      z.object({
        count: z.number().describe("Total number of events"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // Resolve editable org IDs for "onlyMine" filter
      const editableResult = await resolveEditableOrgIds({
        ctx,
        onlyMine: input?.onlyMine,
      });

      // If user has no access, return zero count
      if (editableResult === null) {
        return { count: 0 };
      }

      const { editableOrgIds, isNationAdmin } = editableResult;

      const where = buildEventWhereClause({
        input,
        editableOrgIds,
        isNationAdmin,
      });

      const count = await getEventCount({ db: ctx.db, where });

      return { count };
    }),
  byId: protectedProcedure
    .input(
      z.object({
        id: z.coerce.number().describe("The unique identifier of the event"),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["event"],
      summary: "Get event by ID",
      description:
        "Retrieve detailed information about a specific event including location, schedule, and associated organizations",
    })
    .output(
      z.object({
        event: z
          .object({
            id: z.number().describe("Event ID"),
            name: z.string().describe("Event name"),
            description: z.string().nullable().describe("Event description"),
            isActive: z.boolean().describe("Whether the event is active"),
            location: z.string().nullable().describe("Location"),
            locationId: z.number().nullable().describe("Location ID"),
            startDate: z.string().nullable().describe("Event start date"),
            endDate: z.string().nullable().describe("Event end date"),
            dayOfWeek: z
              .enum(DayOfWeek)
              .nullable()
              .describe("Event day of week"),
            startTime: z.string().nullable().describe("Event start time"),
            endTime: z.string().nullable().describe("Event end time"),
            email: z.string().nullable().describe("Event email"),
            highlight: z.boolean().describe("Whether the event is highlighted"),
            created: z.string().describe("Event creation date"),
            meta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Event metadata"),
            isPrivate: z.boolean().describe("Whether the event is private"),
            aos: z
              .array(
                z.object({
                  aoId: z.number().describe("Parent organization ID"),
                  aoName: z.string().describe("Parent organization name"),
                }),
              )
              .describe("Parent organizations"),
            regions: z
              .array(
                z.object({
                  regionId: z.number().describe("Region ID"),
                  regionName: z.string().describe("Region name"),
                }),
              )
              .describe("Regions"),
            eventTypes: z
              .array(
                z.object({
                  eventTypeId: z.number().describe("Event type ID"),
                  eventTypeName: z.string().describe("Event type name"),
                }),
              )
              .describe("Event types"),
          })
          .nullable()
          .describe("The event"),
      }),
    )
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
          endDate: schema.events.endDate,
          dayOfWeek: schema.events.dayOfWeek,
          startTime: schema.events.startTime,
          endTime: schema.events.endTime,
          email: schema.events.email,
          highlight: schema.events.highlight,
          created: schema.events.created,
          meta: schema.events.meta,
          isPrivate: schema.events.isPrivate,
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

      return { event: event ?? null };
    }),
  crupdate: editorProcedure
    .input(EventInsertSchema.partial({ id: true }))
    .route({
      method: "POST",
      path: "/",
      tags: ["event"],
      summary: "Create or update event",
      description:
        "Create a new event or update an existing one. Requires editor role for the event's organization. Events are associated with locations and can have multiple event types. When creating or updating an event, future instances will be automatically created or updated based on the event's recurrence pattern. Changes to series events will cascade to future instances.",
    })
    .output(
      z.object({
        event: z
          .object({
            id: z.number().describe("Event ID"),
            orgId: z.number().describe("Organization ID"),
            locationId: z.number().nullable().describe("Location ID"),
            seriesId: z.number().nullable().describe("Series ID"),
            isActive: z.boolean().describe("Whether the event is active"),
            highlight: z.boolean().describe("Whether the event is highlighted"),
            startDate: z.string().describe("Event start date"),
            endDate: z.string().nullable().describe("Event end date"),
            startTime: z.string().nullable().describe("Event start time"),
            endTime: z.string().nullable().describe("Event end time"),
            dayOfWeek: z.enum(DayOfWeek).nullable().describe("Day of week"),
            name: z.string().describe("Event name"),
            description: z.string().nullable().describe("Event description"),
            recurrencePattern: z
              .enum(EventCadence)
              .nullable()
              .describe("Recurrence pattern"),
            recurrenceInterval: z
              .number()
              .nullable()
              .describe("Recurrence interval"),
            indexWithinInterval: z
              .number()
              .nullable()
              .describe("Index within interval"),
            meta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Event metadata"),
            isPrivate: z.boolean().describe("Whether the event is private"),
            created: z.string().describe("Date the event was created"),
            updated: z.string().describe("Date the event was last updated"),
            email: z.string().nullable().describe("Event contact email"),
          })
          .nullable()
          .describe("The created or updated event"),
      }),
    )
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
      const mapSeed =
        typeof meta?.mapSeed === "boolean" ? meta.mapSeed : undefined;
      const eventToUpdate: typeof schema.events.$inferInsert = {
        ...eventData,
        orgId: input.aoId,
        meta: meta
          ? {
              ...meta,
              mapSeed,
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
          eventTypeIds.map((eventTypeId: number) => ({
            eventId: result.id,
            eventTypeId,
          })),
        );
      }

      // Handle event instance cascade operations for series (events with recurrence patterns).
      // null recurrencePattern defaults to weekly in createEventInstancesForSeries.
      if (result.dayOfWeek) {
        const {
          isStructuralChange,
          createEventInstancesForSeries,
          updateFutureInstances,
          recreateFutureInstances,
        } = await import("../lib/cascade-service");

        // Build series data for cascade operations
        const seriesData = {
          id: result.id,
          orgId: result.orgId,
          locationId: result.locationId,
          name: result.name,
          description: result.description,
          startDate: result.startDate,
          endDate: result.endDate,
          startTime: result.startTime,
          endTime: result.endTime,
          dayOfWeek: result.dayOfWeek,
          recurrencePattern: result.recurrencePattern,
          recurrenceInterval: result.recurrenceInterval,
          indexWithinInterval: result.indexWithinInterval,
          isActive: result.isActive,
          isPrivate: result.isPrivate,
          highlight: result.highlight,
          meta: result.meta,
          eventTypeIds: eventTypeIds,
          // eventTagId: eventTagIds?.[0], // TODO: event tag support
        };

        if (!existingEvent) {
          // New series: create event instances from series start date
          await createEventInstancesForSeries(
            ctx.db,
            seriesData,
            4,
            seriesData.startDate,
          );

          // Check if this is the first recurring event for the region and
          // trigger the "region in a box" notification flow.
          const { maybeNotifyFirstEventForRegion } =
            await import("../lib/first-event-service");
          void maybeNotifyFirstEventForRegion(ctx.db, result.orgId).catch(
            (err: unknown) =>
              logError("api.event.first_event_notify_failed", {}, err),
          );
        } else if (existingEvent.dayOfWeek) {
          // Existing series: check for structural changes
          const existingSeriesData = {
            dayOfWeek: existingEvent.dayOfWeek,
            recurrencePattern: existingEvent.recurrencePattern,
            recurrenceInterval: existingEvent.recurrenceInterval,
            indexWithinInterval: existingEvent.indexWithinInterval,
            startDate: existingEvent.startDate,
            endDate: existingEvent.endDate,
          };

          const updatedSeriesData = {
            dayOfWeek: result.dayOfWeek,
            recurrencePattern: result.recurrencePattern,
            recurrenceInterval: result.recurrenceInterval,
            indexWithinInterval: result.indexWithinInterval,
            startDate: result.startDate,
            endDate: result.endDate,
          };

          if (isStructuralChange(existingSeriesData, updatedSeriesData)) {
            // Structural change: delete and recreate future instances
            await recreateFutureInstances(ctx.db, seriesData);
          } else {
            // Non-structural change: update future instances in place
            await updateFutureInstances(ctx.db, seriesData);
          }
        } else {
          // Converting a non-series event to a series: create instances from series start date
          await createEventInstancesForSeries(
            ctx.db,
            seriesData,
            4,
            seriesData.startDate,
          );
        }

        // Notify webhooks and invalidate cache about the event change
        notifyMapDataChange({
          type: input.id ? "event.updated" : "event.created",
          eventId: result.id,
        });
      }

      return { event: result ?? null };
    }),
  eventIdToRegionNameLookup: protectedProcedure
    .route({
      method: "GET",
      path: "/event-id-to-region-name-lookup",
      tags: ["event"],
      summary: "Event to region lookup",
      description: "Get a mapping of event IDs to their region names",
    })
    .output(
      z.object({
        lookup: z
          .record(z.string(), z.string())
          .describe("Mapping of event IDs to region names"),
      }),
    )
    .handler(async ({ context: ctx }) => {
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

      return { lookup };
    }),
  delete: editorProcedure
    .input(
      z.object({
        id: z.coerce
          .number()
          .describe("The unique identifier of the event to delete"),
      }),
    )
    .output(
      z.object({
        eventId: z.coerce
          .number()
          .describe("The unique identifier of the event that was deleted"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["event"],
      summary: "Delete event",
      description:
        "Soft delete an event by marking it as inactive. The event will no longer appear on the map but the data is preserved. Future instances of this series event will also be soft deleted.",
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

      // Cascade delete event instances for series events
      const { softDeleteFutureInstancesForSeries } =
        await import("../lib/cascade-service");
      await softDeleteFutureInstancesForSeries(ctx.db, input.id);

      // Notify webhooks and invalidate cache about the event deletion
      notifyMapDataChange({ type: "event.deleted", eventId: input.id });

      return { eventId: input.id };
    }),
};
