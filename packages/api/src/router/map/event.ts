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
  EventCategory,
  IsActiveStatus,
} from "@acme/shared/app/enums";
import { arrayOrSingle, getFullAddress } from "@acme/shared/app/functions";

import { getDescendantOrgIds } from "../../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../../get-editable-org-ids";
import type { Context } from "../../shared";
import { protectedProcedure } from "../../shared";
import { withPagination } from "../../with-pagination";

// Shared filter schema for events (used by both `all` and `count` endpoints)
const eventFilterSchema = z.object({
  searchTerm: z.string().optional(),
  statuses: arrayOrSingle(z.enum(["active", "inactive"])).optional(),
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
  regionIds: arrayOrSingle(z.coerce.number()).optional(),
  aoIds: arrayOrSingle(z.coerce.number()).optional(),
  onlyMine: z.coerce.boolean().optional(),
});

type EventFilterInput = z.infer<typeof eventFilterSchema>;

// Extended schema with pagination and sorting for the `all` endpoint
const eventAllInputSchema = eventFilterSchema
  .extend({
    pageIndex: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    sorting: z
      .array(z.object({ id: z.string(), desc: z.coerce.boolean() }))
      .optional(),
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

  return db
    .select({ count: countDistinct(schema.events.id) })
    .from(schema.events)
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
    .where(where);
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

export const mapEventRouter = {
  all: protectedProcedure
    .input(eventAllInputSchema)
    .route({
      method: "GET",
      path: "/all",
      tags: ["map.event"],
      summary: "List all events (filtered)",
      description:
        "Get a paginated list of workout events with optional filtering and sorting",
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
            parent: z.string().nullable().describe("Parent AO name"),
            locationId: z.number().nullable().describe("Location ID"),
            startDate: z.string().nullable().describe("Event start date"),
            dayOfWeek: z.enum(DayOfWeek).nullable().describe("Day of week"),
            startTime: z.string().nullable().describe("Event start time"),
            endTime: z.string().nullable().describe("Event end time"),
            email: z.string().nullable().describe("Event contact email"),
            created: z.string().describe("Date the event was created"),
            locationName: z.string().nullable().describe("Location name"),
            locationAddress: z
              .string()
              .nullable()
              .describe("Location street address"),
            locationAddress2: z
              .string()
              .nullable()
              .describe("Location street address line 2"),
            locationCity: z.string().nullable().describe("Location city"),
            locationState: z.string().nullable().describe("Location state"),
            locationZip: z.string().nullable().describe("Location zip code"),
            parents: z
              .array(
                z.object({
                  parentId: z.number().describe("Parent org ID"),
                  parentName: z.string().nullable().describe("Parent org name"),
                }),
              )
              .describe("Parent AOs"),
            regions: z
              .array(
                z.object({
                  regionId: z.number().describe("Region ID"),
                  regionName: z.string().nullable().describe("Region name"),
                }),
              )
              .describe("Regions"),
            eventTypes: z
              .array(
                z.object({
                  eventTypeId: z.number().describe("Event type ID"),
                  eventTypeName: z.string().describe("Event type name"),
                  eventCategory: z.string().describe("Event category"),
                }),
              )
              .describe("Event types"),
            location: z
              .string()
              .nullable()
              .describe("Full formatted location address"),
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
        parents: sql<
          { parentId: number; parentName: string | null }[]
        >`COALESCE(
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
            eventCategory: string;
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
};
