import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { InferInsertModel } from "@acme/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  schema,
} from "@acme/db";
import { IsActiveStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import { EventTypeInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const eventTypeRouter = {
  /**
   * By default this gets all the event types available for the orgIds (meaning that general, nation-wide event types are included)
   * To get only the event types for a specific org, set ignoreNationEventTypes to true
   */
  all: protectedProcedure
    .input(
      z
        .object({
          orgIds: arrayOrSingle(z.coerce.number())
            .optional()
            .describe(
              "Filter event types by organization ID(s). Returns types in ANY of the specified orgs. Defaults to nation-wide types.",
            ),
          statuses: arrayOrSingle(z.enum(IsActiveStatus))
            .optional()
            .describe(
              "Filter event types by status. Matches event types with ANY of the given statuses (active, inactive).",
            ),
          pageIndex: z.coerce
            .number()
            .optional()
            .describe("Zero-based page index for pagination. Defaults to 0."),
          pageSize: z.coerce
            .number()
            .optional()
            .describe("Number of event types per page. Defaults to 10."),
          searchTerm: z
            .string()
            .optional()
            .describe(
              "Search event types by name or description. Case-insensitive partial matching.",
            ),
          sorting: parseSorting().describe(
            "Sort results by field(s). Format: [{ id: 'fieldName', desc: true/false }]. Available fields: name, description, eventCategory, specificOrgName, count, created.",
          ),
          ignoreNationEventTypes: z.coerce
            .boolean()
            .optional()
            .describe(
              "If true, only return event types specific to the requested orgs. If false (default), include nation-wide types.",
            ),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["event-type"],
      summary: "List all event types",
      description:
        "Get a paginated list of event types with optional filtering by organization",
    })
    .handler(async ({ context: ctx, input }) => {
      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      const sortedColumns = input?.sorting?.map((sorting) => {
        const direction = sorting.desc ? desc : asc;
        switch (sorting.id) {
          case "name":
            return direction(schema.eventTypes.name);
          case "description":
            return direction(schema.eventTypes.description);
          case "eventCategory":
            return direction(schema.eventTypes.eventCategory);
          case "specificOrgName":
            return direction(schema.orgs.name);
          case "count":
            return direction(count(schema.eventsXEventTypes.eventTypeId));
          case "created":
            return direction(schema.eventTypes.created);
          default:
            return direction(schema.eventTypes.id);
        }
      }) ?? [desc(schema.eventTypes.id)];

      const select = {
        id: schema.eventTypes.id,
        name: schema.eventTypes.name,
        description: schema.eventTypes.description,
        eventCategory: schema.eventTypes.eventCategory,
        specificOrgId: schema.eventTypes.specificOrgId,
        specificOrgName: schema.orgs.name,
        count: count(schema.eventsXEventTypes.eventTypeId),
      };

      const where = and(
        input?.searchTerm
          ? or(
              ilike(schema.eventTypes.name, `%${input?.searchTerm}%`),
              ilike(schema.eventTypes.description, `%${input?.searchTerm}%`),
            )
          : undefined,
        input?.orgIds?.length
          ? or(
              inArray(schema.eventTypes.specificOrgId, input?.orgIds),
              input?.ignoreNationEventTypes
                ? undefined
                : isNull(schema.eventTypes.specificOrgId),
            )
          : undefined,
        !input?.statuses?.length ||
          input.statuses.length === IsActiveStatus.length
          ? undefined
          : input.statuses.includes("active")
            ? eq(schema.eventTypes.isActive, true)
            : eq(schema.eventTypes.isActive, false),
      );

      const [eventTypeCount] = await ctx.db
        .select({ count: count(schema.eventTypes.id) })
        .from(schema.eventTypes)
        .where(where);

      if (!eventTypeCount) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event type not found",
        });
      }
      const totalCount = eventTypeCount?.count;

      const query = ctx.db
        .select(select)
        .from(schema.eventTypes)
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .leftJoin(
          schema.orgs,
          eq(schema.eventTypes.specificOrgId, schema.orgs.id),
        )
        .where(where)
        .groupBy(schema.eventTypes.id, schema.orgs.name);

      const eventTypes = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      return { eventTypes, totalCount };
    }),
  byOrgId: protectedProcedure
    .input(
      z.object({
        orgId: z.coerce
          .number()
          .describe("The organization ID to fetch event types for"),
        isActive: z
          .boolean()
          .optional()
          .describe(
            "Filter event types by status. If not specified, defaults to active only.",
          ),
      }),
    )
    .route({
      method: "GET",
      path: "/org/{orgId}",
      tags: ["event-type"],
      summary: "Get event types by organization",
      description: "Retrieve all event types for a specific organization",
    })
    .handler(async ({ context: ctx, input }) => {
      const eventTypes = await ctx.db
        .select()
        .from(schema.eventTypes)
        .where(
          and(
            eq(schema.eventTypes.specificOrgId, input.orgId),
            input.isActive
              ? eq(schema.eventTypes.isActive, input.isActive)
              : eq(schema.eventTypes.isActive, true),
          ),
        );

      return { eventTypes: eventTypes ?? null };
    }),
  byId: protectedProcedure
    .input(
      z.object({
        id: z.coerce
          .number()
          .describe("The unique identifier of the event type"),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["event-type"],
      summary: "Get event type by ID",
      description:
        "Retrieve detailed information about a specific event type including its category and usage count",
    })
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select()
        .from(schema.eventTypes)
        .where(eq(schema.eventTypes.id, input.id));

      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event type not found",
        });
      }

      return { eventType: result ?? null };
    }),
  crupdate: editorProcedure
    .input(EventTypeInsertSchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["event-type"],
      summary: "Create or update event type",
      description:
        "Create a new event type or update an existing one. Can be created at nation level (for all orgs) or scoped to a specific organization. Requires appropriate permissions.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingEventType] = input.id
        ? await ctx.db
            .select()
            .from(schema.eventTypes)
            .where(eq(schema.eventTypes.id, input.id))
        : [];

      const [nationOrg] = await ctx.db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "nation"));

      if (!nationOrg) {
        throw new ORPCError("NOT_FOUND", {
          message: "Nation organization not found",
        });
      }

      const orgIdForPermissionCheck = existingEventType?.specificOrgId
        ? // If this is editting a specific org's event type, then they need those permissinos
          existingEventType.specificOrgId
        : existingEventType
          ? // If this is a new event type for the nation, then they need to be an editor for the nation org
            nationOrg.id
          : // If this is a new event type in a specific org then they need to be an editor of that org
            (input.specificOrgId ??
            // Otherwise they need to be an editor of the nation
            nationOrg.id);

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: orgIdForPermissionCheck,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to update this Event Type",
        });
      }
      const eventTypeData: InferInsertModel<typeof schema.eventTypes> = {
        ...input,
        // eventCategory: (input.eventCategory ?? "first_f") as EventCategory,
      };
      const result = await ctx.db
        .insert(schema.eventTypes)
        .values(eventTypeData)
        .onConflictDoUpdate({
          target: schema.eventTypes.id,
          set: eventTypeData,
        })
        .returning();

      return { eventType: result ?? null };
    }),
  delete: editorProcedure
    .input(
      z.object({
        id: z
          .number()
          .describe("The unique identifier of the event type to delete"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/id/{id}",
      tags: ["event-type"],
      summary: "Delete event type",
      description:
        "Soft delete an event type by marking it as inactive. Also removes all associations with events.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingEventType] = await ctx.db
        .select()
        .from(schema.eventTypes)
        .where(eq(schema.eventTypes.id, input.id));

      const [nationOrg] = await ctx.db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "nation"));

      if (!nationOrg) {
        throw new ORPCError("NOT_FOUND", {
          message: "Nation organization not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: existingEventType?.specificOrgId ?? nationOrg.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this Event Type",
        });
      }

      await ctx.db
        .delete(schema.eventsXEventTypes)
        .where(eq(schema.eventsXEventTypes.eventTypeId, input.id));

      await ctx.db
        .update(schema.eventTypes)
        .set({ isActive: false })
        .where(eq(schema.eventTypes.id, input.id));
    }),
};
