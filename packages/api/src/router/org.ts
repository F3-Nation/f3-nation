import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  aliasedTable,
  and,
  countDistinct,
  eq,
  ilike,
  inArray,
  or,
  schema,
  sql,
} from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { IsActiveStatus, OrgType } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import type { OrgMeta } from "@acme/shared/app/types";
import { OrgInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { moveAOLocsToNewRegion } from "../lib/move-ao-locs-to-new-region";
import { emitWebhookEvent } from "../lib/webhook-events";
import type { Context } from "../shared";
import { adminProcedure, editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

interface Org {
  id: number;
  parentId: number | null;
  name: string;
  orgType: "ao" | "region" | "area" | "sector" | "nation";
  defaultLocationId: number | null;
  description: string | null;
  isActive: boolean;
  logoUrl: string | null;
  website: string | null;
  email: string | null;
  twitter: string | null;
  facebook: string | null;
  instagram: string | null;
  lastAnnualReview: string | null;
  meta: OrgMeta;
  created: string;
  parentOrgName: string;
  parentOrgType: "ao" | "region" | "area" | "sector" | "nation";
}

// Shared filter schema for orgs (used by both `all` and `count` endpoints)
const orgFilterSchema = z.object({
  orgTypes: arrayOrSingle(z.enum(OrgType))
    .refine((val) => val.length >= 1, {
      message: "At least one orgType is required",
    })
    .default(["region"]),
  searchTerm: z.string().optional(),
  statuses: arrayOrSingle(z.enum(IsActiveStatus)).optional(),
  parentOrgIds: arrayOrSingle(z.coerce.number()).optional(),
  onlyMine: z.coerce.boolean().optional(),
});

type OrgFilterInput = z.infer<typeof orgFilterSchema>;

// Extended schema with pagination and sorting for the `all` endpoint
const orgAllInputSchema = orgFilterSchema.extend({
  pageIndex: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sorting: parseSorting(),
});

// Aliased tables used across org queries
const org = aliasedTable(schema.orgs, "org");
const parentOrg = aliasedTable(schema.orgs, "parent_org");

/**
 * Resolves editable org IDs for "onlyMine" filter
 * Returns null if user has no access
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
    const editableOrgIdsList = editableOrgs.map((o) => o.id);
    const editableOrgIds = await getDescendantOrgIds(
      ctx.db,
      editableOrgIdsList,
    );
    return { editableOrgIds, isNationAdmin };
  }

  // If user has no editable orgs and is not a nation admin, return null
  if (editableOrgs.length === 0 && !isNationAdmin) {
    return null;
  }

  return { editableOrgIds: [], isNationAdmin };
}

/**
 * Builds the WHERE clause for org queries based on filter input
 */
function buildOrgWhereClause(params: {
  input: OrgFilterInput;
  editableOrgIds: number[];
  isNationAdmin: boolean;
}): SQL | undefined {
  const { input, editableOrgIds, isNationAdmin } = params;

  return and(
    inArray(org.orgType, input.orgTypes),
    !input.statuses
      ? eq(org.isActive, true)
      : !input.statuses.length ||
          input.statuses.length === IsActiveStatus.length
        ? undefined
        : input.statuses.includes("active")
          ? eq(org.isActive, true)
          : eq(org.isActive, false),
    input.searchTerm
      ? or(
          ilike(org.name, `%${input.searchTerm}%`),
          ilike(org.description, `%${input.searchTerm}%`),
        )
      : undefined,
    input.parentOrgIds?.length
      ? inArray(org.parentId, input.parentOrgIds)
      : undefined,
    // Filter by editable org IDs if onlyMine is true and not a nation admin
    input.onlyMine && !isNationAdmin && editableOrgIds.length > 0
      ? inArray(org.id, editableOrgIds)
      : undefined,
  );
}

/**
 * Gets the count of orgs matching the given WHERE clause
 */
async function getOrgCount(params: {
  db: AppDb;
  where: SQL | undefined;
}): Promise<number> {
  const { db, where } = params;

  const [result] = await db
    .select({ count: countDistinct(org.id) })
    .from(org)
    .leftJoin(parentOrg, eq(org.parentId, parentOrg.id))
    .where(where);

  return result?.count ?? 0;
}

export const orgRouter = {
  all: protectedProcedure
    .input(orgAllInputSchema)
    .route({
      method: "GET",
      path: "/",
      tags: ["org"],
      summary: "List all organizations",
      description:
        "Get a paginated list of organizations (regions, AOs, etc.) with optional filtering and sorting",
    })
    .handler(async ({ context: ctx, input }) => {
      const pageSize = input.pageSize ?? 10;
      const pageIndex = (input.pageIndex ?? 0) * pageSize;
      const usePagination =
        input.pageIndex !== undefined && input.pageSize !== undefined;

      // Resolve editable org IDs for "onlyMine" filter
      const editableResult = await resolveEditableOrgIds({
        ctx,
        onlyMine: input.onlyMine,
      });

      // If user has no access, return empty result
      if (editableResult === null) {
        return { orgs: [], total: 0 };
      }

      const { editableOrgIds, isNationAdmin } = editableResult;

      const where = buildOrgWhereClause({
        input,
        editableOrgIds,
        isNationAdmin,
      });

      const sortedColumns = getSortingColumns(
        input.sorting,
        {
          id: org.id,
          name: org.name,
          parentOrgName: parentOrg.name,
          status: org.isActive,
          created: org.created,
        },
        "id",
      );

      const total = await getOrgCount({ db: ctx.db, where });

      const select = {
        id: org.id,
        parentId: org.parentId,
        name: org.name,
        orgType: org.orgType,
        defaultLocationId: org.defaultLocationId,
        description: org.description,
        isActive: org.isActive,
        logoUrl: org.logoUrl,
        website: org.website,
        email: org.email,
        twitter: org.twitter,
        facebook: org.facebook,
        instagram: org.instagram,
        lastAnnualReview: org.lastAnnualReview,
        meta: org.meta,
        created: org.created,
        parentOrgName: parentOrg.name,
        parentOrgType: parentOrg.orgType,
        aoCount: org.aoCount,
      };

      const query = ctx.db
        .select(select)
        .from(org)
        .leftJoin(parentOrg, eq(org.parentId, parentOrg.id))
        .where(where);

      const orgs_untyped = usePagination
        ? await withPagination(
            query.$dynamic(),
            sortedColumns,
            pageIndex,
            pageSize,
          )
        : await query.orderBy(...sortedColumns);

      // Something is broken with org to org types
      return { orgs: orgs_untyped as Org[], total };
    }),

  count: protectedProcedure
    .input(orgFilterSchema)
    .route({
      method: "GET",
      path: "/count",
      tags: ["org"],
      summary: "Count organizations",
      description:
        "Get the count of organizations matching the specified filters",
    })
    .handler(async ({ context: ctx, input }) => {
      // Resolve editable org IDs for "onlyMine" filter
      const editableResult = await resolveEditableOrgIds({
        ctx,
        onlyMine: input.onlyMine,
      });

      // If user has no access, return 0
      if (editableResult === null) {
        return { count: 0 };
      }

      const { editableOrgIds, isNationAdmin } = editableResult;

      const where = buildOrgWhereClause({
        input,
        editableOrgIds,
        isNationAdmin,
      });

      const count = await getOrgCount({ db: ctx.db, where });

      return { count };
    }),

  byId: protectedProcedure
    .input(
      z.object({ id: z.coerce.number(), orgType: z.enum(OrgType).optional() }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["org"],
      summary: "Get organization by ID",
      description:
        "Retrieve detailed information about a specific organization",
    })
    .handler(async ({ context: ctx, input }) => {
      const [org] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.id, input.id),
            input.orgType ? eq(schema.orgs.orgType, input.orgType) : undefined,
          ),
        );
      return { org: org ?? null };
    }),

  crupdate: editorProcedure
    .input(OrgInsertSchema.partial({ id: true, parentId: true }))
    .route({
      method: "POST",
      path: "/",
      tags: ["org"],
      summary: "Create or update organization",
      description: "Create a new organization or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      const orgIdToCheck = input.id ?? input.parentId;
      if (!orgIdToCheck) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Parent ID or ID is required",
        });
      }
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: orgIdToCheck,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to update this org",
        });
      }

      // CASE 1: Create new org
      if (!input.id) {
        const [result] = await ctx.db
          .insert(schema.orgs)
          .values({
            ...input,
            meta: input.meta as Record<string, string>,
          })
          .returning();

        // Notify webhooks about the org creation
        if (result) {
          emitWebhookEvent({ type: "org.created", orgId: result.id });
        }

        return { org: result ?? null };
      }

      // CASE 2: Update existing org
      const [existingOrg] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.id));

      if (!existingOrg) {
        throw new ORPCError("NOT_FOUND", {
          message: "Org not found",
        });
      }

      if (existingOrg?.orgType !== input.orgType) {
        throw new ORPCError("BAD_REQUEST", {
          message: `org to edit is not a ${input.orgType ?? "unknown"}`,
        });
      }

      // If the parentId is changing and this is an AO, we need to move the locations for the org
      if (
        input.parentId &&
        existingOrg.parentId &&
        input.parentId !== existingOrg.parentId &&
        input.orgType === "ao"
      ) {
        await moveAOLocsToNewRegion(ctx, {
          oldRegionId: existingOrg.parentId,
          newRegionId: input.parentId,
          aoId: existingOrg.id,
        });
      }

      // 2. Update the org with the new values

      const orgToCrupdate: typeof schema.orgs.$inferInsert = {
        ...input,
        meta: input.meta as Record<string, string>,
      };

      const [result] = await ctx.db
        .insert(schema.orgs)
        .values(orgToCrupdate)
        .onConflictDoUpdate({
          target: [schema.orgs.id],
          set: orgToCrupdate,
        })
        .returning();

      // Notify webhooks about the org update
      if (result) {
        emitWebhookEvent({ type: "org.updated", orgId: result.id });
      }

      return { org: result ?? null };
    }),
  mine: protectedProcedure
    .route({
      method: "GET",
      path: "/mine",
      tags: ["org"],
      summary: "Get my organizations",
      description: "Get all organizations where the current user has roles",
    })
    .handler(async ({ context: ctx }) => {
      if (!ctx.session?.id) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to get your orgs",
        });
      }

      const orgsQuery = await ctx.db
        .select()
        .from(schema.rolesXUsersXOrg)
        .innerJoin(
          schema.orgs,
          eq(schema.rolesXUsersXOrg.orgId, schema.orgs.id),
        )
        .innerJoin(
          schema.roles,
          eq(schema.rolesXUsersXOrg.roleId, schema.roles.id),
        )
        .where(eq(schema.rolesXUsersXOrg.userId, ctx.session.id));

      // Reduce multiple rows per org down to one row per org with possibly multiple roles
      const orgMap: Record<
        number,
        {
          orgs: (typeof orgsQuery)[number]["orgs"];
          roles_x_users_x_org: (typeof orgsQuery)[number]["roles_x_users_x_org"];
          roles: (typeof orgsQuery)[number]["roles"]["name"][];
        }
      > = {};

      for (const row of orgsQuery) {
        const orgId = row.orgs.id;
        if (!orgMap[orgId]) {
          orgMap[orgId] = {
            orgs: row.orgs,
            roles_x_users_x_org: row.roles_x_users_x_org,
            roles: [],
          };
        }
        if (row.roles?.name) {
          orgMap[orgId]?.roles.push(row.roles.name);
        }
      }

      return {
        orgs: Object.values(orgMap).map((org) => ({
          id: org.orgs.id,
          name: org.orgs.name,
          orgType: org.orgs.orgType,
          parentId: org.orgs.parentId,
          roles: org.roles,
        })),
      };
    }),
  delete: adminProcedure
    .input(
      z.object({ id: z.coerce.number(), orgType: z.enum(OrgType).optional() }),
    )
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["org"],
      summary: "Delete organization",
      description:
        "Soft delete an organization by marking it as inactive. For AO orgs, this also soft-deletes associated series and future event instances.",
    })
    .handler(async ({ context: ctx, input }) => {
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this org",
        });
      }

      // Get the org type before deleting to determine if cascading is needed
      const [org] = await ctx.db
        .select({ orgType: schema.orgs.orgType })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.id));

      // Soft delete the org itself
      await ctx.db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.orgs.id, input.id),
            input.orgType ? eq(schema.orgs.orgType, input.orgType) : undefined,
            eq(schema.orgs.isActive, true),
          ),
        );

      // Notify webhooks about the org deletion
      emitWebhookEvent({ type: "org.deleted", orgId: input.id });

      // If this is an AO, cascade soft-delete to series and event instances
      if (org?.orgType === "ao") {
        const { softDeleteSeriesForOrg, softDeleteFutureInstancesForOrg } =
          await import("../lib/cascade-service");

        await softDeleteSeriesForOrg(ctx.db, input.id);
        await softDeleteFutureInstancesForOrg(ctx.db, input.id);
      }

      return { orgId: input.id };
    }),
  revalidate: adminProcedure
    .route({
      method: "POST",
      path: "/revalidate",
      tags: ["org"],
      summary: "Revalidate cache",
      description: "Trigger cache revalidation for the organization data",
    })
    .handler(async ({ context: ctx }) => {
      const [nation] = await ctx.db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "nation"));
      if (!nation) {
        throw new ORPCError("NOT_FOUND", {
          message: "Nation not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: nation.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to revalidate this Nation",
        });
      }

      revalidatePath("/");
    }),
};
