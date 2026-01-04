import { ORPCError } from "@orpc/server";
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
} from "@acme/db";
import { IsActiveStatus, OrgType } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import type { OrgMeta } from "@acme/shared/app/types";
import { OrgInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getSortingColumns } from "../get-sorting-columns";
import { moveAOLocsToNewRegion } from "../lib/move-ao-locs-to-new-region";
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

export const orgRouter = {
  all: protectedProcedure
    .input(
      z.object({
        orgTypes: arrayOrSingle(z.enum(OrgType)).refine(
          (val) => val.length >= 1,
          { message: "At least one orgType is required" },
        ),
        pageIndex: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
        searchTerm: z.string().optional(),
        sorting: parseSorting(),
        statuses: arrayOrSingle(z.enum(IsActiveStatus)).optional(),
        parentOrgIds: arrayOrSingle(z.coerce.number()).optional(),
      }),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["org"],
      summary: "List all organizations",
      description:
        "Get a paginated list of organizations (regions, AOs, etc.) with optional filtering and sorting",
    })
    .handler(async ({ context: ctx, input }) => {
      const org = aliasedTable(schema.orgs, "org");
      const parentOrg = aliasedTable(schema.orgs, "parent_org");
      const pageSize = input?.pageSize ?? 10;
      const pageIndex = (input?.pageIndex ?? 0) * pageSize;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      const where = and(
        inArray(org.orgType, input.orgTypes),
        !input.statuses
          ? eq(org.isActive, true)
          : !input.statuses.length ||
              input.statuses.length === IsActiveStatus.length
            ? undefined
            : input.statuses.includes("active")
              ? eq(org.isActive, true)
              : eq(org.isActive, false),
        input?.searchTerm
          ? or(
              ilike(org.name, `%${input?.searchTerm}%`),
              ilike(org.description, `%${input?.searchTerm}%`),
            )
          : undefined,
        input?.parentOrgIds?.length
          ? inArray(org.parentId, input.parentOrgIds)
          : undefined,
      );

      const sortedColumns = getSortingColumns(
        input?.sorting,
        {
          id: org.id,
          name: org.name,
          parentOrgName: parentOrg.name,
          status: org.isActive,
          created: org.created,
        },
        "id",
      );

      const [orgCount] = await ctx.db
        .select({ count: countDistinct(org.id) })
        .from(org)
        .leftJoin(parentOrg, eq(org.parentId, parentOrg.id))
        .where(where);

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
      return { orgs: orgs_untyped as Org[], total: orgCount?.count ?? 0 };
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
          message: `org to edit is not a ${input.orgType}`,
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
    .input(z.object({ id: z.number(), orgType: z.enum(OrgType).optional() }))
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["org"],
      summary: "Delete organization",
      description: "Soft delete an organization by marking it as inactive",
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
