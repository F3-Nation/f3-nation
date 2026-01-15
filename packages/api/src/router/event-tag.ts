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
import { EventTagInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const eventTagRouter = {
  /**
   * By default this gets all the event tags available for the orgIds (meaning that general, nation-wide event tags are included)
   * To get only the event tags for a specific org, set ignoreNationEventTags to true
   */
  all: protectedProcedure
    .input(
      z
        .object({
          orgIds: arrayOrSingle(z.coerce.number()).optional(),
          statuses: arrayOrSingle(z.enum(IsActiveStatus)).optional(),
          pageIndex: z.coerce.number().optional(),
          pageSize: z.coerce.number().optional(),
          searchTerm: z.string().optional(),
          sorting: parseSorting(),
          ignoreNationEventTags: z.coerce.boolean().optional(),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["event-tag"],
      summary: "List all event tags",
      description:
        "Get a paginated list of event tags with optional filtering by organization",
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
            return direction(schema.eventTags.name);
          case "description":
            return direction(schema.eventTags.description);
          case "color":
            return direction(schema.eventTags.color);
          case "specificOrgName":
            return direction(schema.orgs.name);
          case "created":
            return direction(schema.eventTags.created);
          default:
            return direction(schema.eventTags.id);
        }
      }) ?? [desc(schema.eventTags.id)];

      const select = {
        id: schema.eventTags.id,
        name: schema.eventTags.name,
        description: schema.eventTags.description,
        color: schema.eventTags.color,
        specificOrgId: schema.eventTags.specificOrgId,
        specificOrgName: schema.orgs.name,
        isActive: schema.eventTags.isActive,
      };

      const where = and(
        input?.searchTerm
          ? or(
              ilike(schema.eventTags.name, `%${input?.searchTerm}%`),
              ilike(schema.eventTags.description, `%${input?.searchTerm}%`),
            )
          : undefined,
        input?.orgIds?.length
          ? or(
              inArray(schema.eventTags.specificOrgId, input?.orgIds),
              input?.ignoreNationEventTags
                ? undefined
                : isNull(schema.eventTags.specificOrgId),
            )
          : undefined,
        !input?.statuses?.length ||
          input.statuses.length === IsActiveStatus.length
          ? undefined
          : input.statuses.includes("active")
            ? eq(schema.eventTags.isActive, true)
            : eq(schema.eventTags.isActive, false),
      );

      const [eventTagCount] = await ctx.db
        .select({ count: count(schema.eventTags.id) })
        .from(schema.eventTags)
        .where(where);

      const totalCount = eventTagCount?.count ?? 0;

      const query = ctx.db
        .select(select)
        .from(schema.eventTags)
        .leftJoin(
          schema.orgs,
          eq(schema.eventTags.specificOrgId, schema.orgs.id),
        )
        .where(where);

      const eventTags = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      return { eventTags, totalCount };
    }),
  byOrgId: protectedProcedure
    .input(
      z.object({
        orgId: z.coerce.number(),
        isActive: z.coerce.boolean().optional(),
      }),
    )
    .route({
      method: "GET",
      path: "/org/{orgId}",
      tags: ["event-tag"],
      summary: "Get event tags by organization",
      description: "Retrieve all event tags for a specific organization",
    })
    .handler(async ({ context: ctx, input }) => {
      const eventTags = await ctx.db
        .select()
        .from(schema.eventTags)
        .where(
          and(
            eq(schema.eventTags.specificOrgId, input.orgId),
            input.isActive !== undefined
              ? eq(schema.eventTags.isActive, input.isActive)
              : eq(schema.eventTags.isActive, true),
          ),
        );

      return { eventTags: eventTags ?? null };
    }),
  byId: protectedProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["event-tag"],
      summary: "Get event tag by ID",
      description: "Retrieve detailed information about a specific event tag",
    })
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select()
        .from(schema.eventTags)
        .where(eq(schema.eventTags.id, input.id));

      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event tag not found",
        });
      }

      return { eventTag: result ?? null };
    }),
  crupdate: editorProcedure
    .input(EventTagInsertSchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["event-tag"],
      summary: "Create or update event tag",
      description: "Create a new event tag or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingEventTag] = input.id
        ? await ctx.db
            .select()
            .from(schema.eventTags)
            .where(eq(schema.eventTags.id, input.id))
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

      const orgIdForPermissionCheck = existingEventTag?.specificOrgId
        ? existingEventTag.specificOrgId
        : existingEventTag
          ? nationOrg.id
          : input.specificOrgId ?? nationOrg.id;

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: orgIdForPermissionCheck,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to update this Event Tag",
        });
      }
      const eventTagData: InferInsertModel<typeof schema.eventTags> = {
        ...input,
      };
      const result = await ctx.db
        .insert(schema.eventTags)
        .values(eventTagData)
        .onConflictDoUpdate({
          target: schema.eventTags.id,
          set: eventTagData,
        })
        .returning();

      return { eventTag: result ?? null };
    }),
  delete: editorProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "DELETE",
      path: "/id/{id}",
      tags: ["event-tag"],
      summary: "Delete event tag",
      description: "Soft delete an event tag by marking it as inactive",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingEventTag] = await ctx.db
        .select()
        .from(schema.eventTags)
        .where(eq(schema.eventTags.id, input.id));

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
        orgId: existingEventTag?.specificOrgId ?? nationOrg.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this Event Tag",
        });
      }

      await ctx.db
        .update(schema.eventTags)
        .set({ isActive: false })
        .where(eq(schema.eventTags.id, input.id));
    }),
};
