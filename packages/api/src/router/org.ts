import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import {
  aliasedTable,
  and,
  count,
  countDistinct,
  eq,
  ilike,
  inArray,
  or,
  schema,
} from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { F3_NATION_ORG_ID } from "@acme/shared/app/constants";
import { IsActiveStatus, OrgType } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import { OrgInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { moveAOLocsToNewRegion } from "../lib/move-ao-locs-to-new-region";
import { paginationFields, resolvePagination } from "../lib/pagination";
import { notifyMapDataChange } from "../lib/webhook-events";
import type { Context } from "../shared";
import { adminProcedure, editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

// Shared filter schema for orgs (used by both `all` and `count` endpoints)
const orgFilterSchema = z.object({
  orgTypes: arrayOrSingle(z.enum(OrgType))
    .refine((val) => val.length >= 1, {
      message: "At least one orgType is required",
    })
    .default(["region"])
    .describe(
      "Filter organizations by type. Returns orgs matching ANY of the given types (region, area, ao, sector, nation). Defaults to [region].",
    ),
  searchTerm: z
    .string()
    .optional()
    .describe(
      "Search organizations by name or description. Case-insensitive partial matching.",
    ),
  statuses: arrayOrSingle(z.enum(IsActiveStatus))
    .optional()
    .describe(
      "Filter organizations by status. Matches orgs with ANY of the given statuses (active, inactive).",
    ),
  parentOrgIds: arrayOrSingle(z.coerce.number())
    .optional()
    .describe(
      "Filter organizations by parent ID(s). Returns orgs with ANY of the specified parents.",
    ),
  onlyMine: z.coerce
    .boolean()
    .optional()
    .describe(
      "If true, only return organizations where the requester has editor or admin role.",
    ),
});

type OrgFilterInput = z.infer<typeof orgFilterSchema>;

// Extended schema with pagination and sorting for the `all` endpoint
const orgAllInputSchema = orgFilterSchema.extend({
  ...paginationFields("organizations"),
  sorting: parseSorting().describe(
    "Sort results by field(s). Format: [{ id: 'fieldName', desc: true/false }]. Available fields: id, name, orgType, isActive, created.",
  ),
});

// Schema for the `accessible` endpoint with pagination and sorting
const orgAccessibleInputSchema = z.object({
  orgTypes: arrayOrSingle(z.enum(OrgType)).optional(),
  ...paginationFields("organizations"),
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

  // TS6.0: aliasedTable complex conditional types require explicit annotation
  const [result] = (await db
    .select({ count: countDistinct(org.id) })
    .from(org)
    .leftJoin(parentOrg, eq(org.parentId, parentOrg.id))
    .where(where)) as { count: number }[];

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
        "Get a paginated list of organizations (regions, areas, AOs, etc.) filtered by type, status, and other criteria. Supports searching, sorting, and pagination. Organizations are organized hierarchically.",
    })
    .output(
      z.object({
        orgs: z.array(
          z.object({
            id: z.number().describe("Organization ID"),
            parentId: z.number().nullable().describe("Parent organization ID"),
            name: z.string().describe("Organization name"),
            orgType: z.enum(OrgType).describe("Organization type"),
            defaultLocationId: z
              .number()
              .nullable()
              .describe("Default location ID"),
            description: z
              .string()
              .nullable()
              .describe("Organization description"),
            isActive: z
              .boolean()
              .describe("Whether the organization is active"),
            logoUrl: z.string().nullable().describe("Organization logo URL"),
            website: z.string().nullable().describe("Organization website"),
            email: z.string().nullable().describe("Organization email"),
            phone: z.string().nullable().describe("Organization phone number"),
            twitter: z
              .string()
              .nullable()
              .describe("Organization Twitter handle"),
            facebook: z
              .string()
              .nullable()
              .describe("Organization Facebook page"),
            instagram: z
              .string()
              .nullable()
              .describe("Organization Instagram handle"),
            lastAnnualReview: z
              .string()
              .nullable()
              .describe("Last annual review date"),
            meta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Organization metadata"),
            created: z.string().describe("Organization creation date"),
            parentOrgName: z
              .string()
              .nullable()
              .describe("Parent organization name"),
            parentOrgType: z
              .enum(OrgType)
              .nullable()
              .describe("Parent organization type"),
            aoCount: z
              .number()
              .nullable()
              .describe("Number of AOs under this organization"),
          }),
        ),
        total: z.number().describe("Total number of organizations"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // orgAllInputSchema is a required object (not `.optional()`), same as
      // the unguarded `input.onlyMine` below — no `?.` needed here.
      const { limit, offset, usePagination } = resolvePagination({
        pageSize: input.pageSize,
        pageIndex: input.pageIndex,
        defaultPageSize: 10,
      });

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
          aoCount: org.aoCount,
          lastAnnualReview: org.lastAnnualReview,
          status: org.isActive,
          created: org.created,
        },
        "id",
        new Set(["parentOrgName", "lastAnnualReview"] as const),
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
        phone: org.phone,
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
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns).limit(limit);

      // Something is broken with org to org types
      return { orgs: orgs_untyped, total };
    }),

  count: protectedProcedure
    .input(orgFilterSchema)
    .route({
      method: "GET",
      path: "/count",
      tags: ["org"],
      summary: "Count organizations",
      description:
        "Get the total count of organizations matching the specified filters. Useful for determining pagination requirements.",
    })
    .output(
      z.object({
        count: z.number().describe("Total number of matching organizations"),
      }),
    )
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

  accessible: protectedProcedure
    .input(orgAccessibleInputSchema.optional())
    .route({
      method: "GET",
      path: "/accessible",
      tags: ["org"],
      summary: "Get accessible organizations",
      description:
        "Get all organizations that the current user has access to. If user has orgId=1 (F3 Nation), returns all orgs. Otherwise returns only assigned orgs. Supports pagination and sorting.",
    })
    .output(
      z.object({
        orgs: z
          .array(
            z.object({
              id: z.number().describe("Organization ID"),
              name: z.string().describe("Organization name"),
              orgType: z.enum(OrgType).describe("Organization type"),
              parentId: z
                .number()
                .nullable()
                .describe("Parent organization ID"),
              roles: z
                .array(z.string())
                .describe("Roles the user has on this organization"),
            }),
          )
          .describe("List of accessible organizations"),
        total: z.number().describe("Total number of accessible organizations"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      if (!ctx.session?.id) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to get your orgs",
        });
      }

      const { limit, offset, usePagination } = resolvePagination({
        pageSize: input?.pageSize,
        pageIndex: input?.pageIndex,
        defaultPageSize: 10,
      });

      // Check if user has a role with orgId = 1 (F3 Nation)
      const [nationRole] = await ctx.db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(
          and(
            eq(schema.rolesXUsersXOrg.userId, ctx.session.id),
            eq(schema.rolesXUsersXOrg.orgId, F3_NATION_ORG_ID),
          ),
        );

      // If user has F3 Nation role, return all orgs with pagination and sorting
      if (nationRole) {
        const sortedColumns = getSortingColumns(
          input?.sorting,
          {
            id: schema.orgs.id,
            name: schema.orgs.name,
            orgType: schema.orgs.orgType,
            parentId: schema.orgs.parentId,
          },
          "name",
        );

        const baseQuery = ctx.db
          .select({
            id: schema.orgs.id,
            name: schema.orgs.name,
            orgType: schema.orgs.orgType,
            parentId: schema.orgs.parentId,
          })
          .from(schema.orgs)
          .where(
            input?.orgTypes?.length
              ? inArray(schema.orgs.orgType, input.orgTypes)
              : undefined,
          );

        const totalQuery = ctx.db
          .select({ count: count(schema.orgs.id) })
          .from(schema.orgs)
          .where(
            input?.orgTypes?.length
              ? inArray(schema.orgs.orgType, input.orgTypes)
              : undefined,
          );

        const [totalResult] = await totalQuery;
        const total = totalResult?.count ?? 0;

        const allOrgs = usePagination
          ? await withPagination(
              baseQuery.$dynamic(),
              sortedColumns,
              offset,
              limit,
            )
          : await baseQuery.orderBy(...sortedColumns).limit(limit);

        return {
          orgs: allOrgs.map((org) => ({
            id: org.id,
            name: org.name,
            orgType: org.orgType,
            parentId: org.parentId,
            roles: [], // No roles when returning all orgs
          })),
          total,
        };
      }

      // Get the user's direct role assignments
      const directRolesQuery = await ctx.db
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

      // Build a map of orgId -> role names for the user's direct assignments
      const directRolesMap = new Map<string, string[]>();
      for (const row of directRolesQuery) {
        const orgId = row.orgs.id;
        const key = String(orgId);
        const existing = directRolesMap.get(key) ?? [];
        if (row.roles?.name) {
          existing.push(row.roles.name);
        }
        directRolesMap.set(key, existing);
      }

      // Get all editable orgs (includes descendants via hierarchy traversal)
      const { editableOrgs } = await getEditableOrgIdsForUser(ctx);
      const directEditableIds = editableOrgs
        .map((o) => o.id)
        .filter((id): id is number => id !== null);

      const editableOrgIds =
        directEditableIds.length > 0
          ? await getDescendantOrgIds(ctx.db, directEditableIds)
          : [];

      // Query full org details for all editable orgs
      const editableOrgsData = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          orgType: schema.orgs.orgType,
          parentId: schema.orgs.parentId,
        })
        .from(schema.orgs)
        .where(
          and(
            inArray(schema.orgs.id, editableOrgIds),
            input?.orgTypes?.length
              ? inArray(schema.orgs.orgType, input.orgTypes)
              : undefined,
          ),
        );

      const allAssignedOrgs = editableOrgsData.map((org) => ({
        id: org.id,
        name: org.name,
        orgType: org.orgType,
        parentId: org.parentId,
        roles: directRolesMap.get(String(org.id)) ?? [],
      }));

      // Sort the orgs array manually since we're working with in-memory data
      const sortedOrgs = [...allAssignedOrgs];
      if (input?.sorting && input.sorting.length > 0) {
        sortedOrgs.sort((a, b) => {
          for (const sort of input.sorting ?? []) {
            let aVal: string | number | null;
            let bVal: string | number | null;

            switch (sort.id) {
              case "id":
                aVal = a.id;
                bVal = b.id;
                break;
              case "name":
                aVal = a.name;
                bVal = b.name;
                break;
              case "orgType":
                aVal = a.orgType;
                bVal = b.orgType;
                break;
              case "parentId":
                aVal = a.parentId;
                bVal = b.parentId;
                break;
              default:
                continue;
            }

            if (aVal === null && bVal === null) continue;
            if (aVal === null) return sort.desc ? 1 : -1;
            if (bVal === null) return sort.desc ? -1 : 1;

            const comparison =
              typeof aVal === "string" && typeof bVal === "string"
                ? aVal.localeCompare(bVal)
                : aVal < bVal
                  ? -1
                  : aVal > bVal
                    ? 1
                    : 0;

            if (comparison !== 0) {
              return sort.desc ? -comparison : comparison;
            }
          }
          return 0;
        });
      }

      // Apply pagination
      const total = sortedOrgs.length;
      const paginatedOrgs = usePagination
        ? sortedOrgs.slice(offset, offset + limit)
        : sortedOrgs.slice(0, limit);

      return {
        orgs: paginatedOrgs,
        total,
      };
    }),

  byId: protectedProcedure
    .input(
      z.object({
        id: z.coerce
          .number()
          .describe("The unique identifier of the organization"),
        orgType: z
          .enum(OrgType)
          .optional()
          .describe("Hint for the organization type to optimize queries"),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["org"],
      summary: "Get organization by ID",
      description:
        "Retrieve detailed information about a specific organization including its structure, metadata, and parent/child relationships",
    })
    .output(
      z.object({
        org: z
          .object({
            id: z.number().describe("Organization ID"),
            parentId: z.number().nullable().describe("Parent organization ID"),
            name: z.string().describe("Organization name"),
            orgType: z.enum(OrgType).describe("Organization type"),
            defaultLocationId: z
              .number()
              .nullable()
              .describe("Default location ID"),
            description: z
              .string()
              .nullable()
              .describe("Organization description"),
            isActive: z
              .boolean()
              .describe("Whether the organization is active"),
            logoUrl: z.string().nullable().describe("Organization logo URL"),
            website: z.string().nullable().describe("Organization website"),
            email: z.string().nullable().describe("Organization email"),
            phone: z.string().nullable().describe("Organization phone number"),
            twitter: z
              .string()
              .nullable()
              .describe("Organization Twitter handle"),
            facebook: z
              .string()
              .nullable()
              .describe("Organization Facebook page"),
            instagram: z
              .string()
              .nullable()
              .describe("Organization Instagram handle"),
            lastAnnualReview: z
              .string()
              .nullable()
              .describe("Last annual review date"),
            meta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Organization metadata"),
            created: z.string().describe("Organization creation date"),
            updated: z.string().describe("Organization last updated date"),
            aoCount: z
              .number()
              .nullable()
              .describe("Number of AOs under this organization"),
          })
          .nullable()
          .describe("The organization"),
      }),
    )
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
      description:
        "Create a new organization or update an existing one. Requires editor role for the organization or its parent. Organizations follow a hierarchical structure (nation → region → area → ao).",
    })
    .output(
      z.object({
        org: z
          .object({
            id: z.number().describe("Organization ID"),
            parentId: z.number().nullable().describe("Parent organization ID"),
            name: z.string().describe("Organization name"),
            orgType: z.enum(OrgType).describe("Organization type"),
            defaultLocationId: z
              .number()
              .nullable()
              .describe("Default location ID"),
            description: z
              .string()
              .nullable()
              .describe("Organization description"),
            isActive: z
              .boolean()
              .describe("Whether the organization is active"),
            logoUrl: z.string().nullable().describe("Organization logo URL"),
            website: z.string().nullable().describe("Organization website"),
            email: z.string().nullable().describe("Organization email"),
            phone: z.string().nullable().describe("Organization phone number"),
            twitter: z
              .string()
              .nullable()
              .describe("Organization Twitter handle"),
            facebook: z
              .string()
              .nullable()
              .describe("Organization Facebook page"),
            instagram: z
              .string()
              .nullable()
              .describe("Organization Instagram handle"),
            lastAnnualReview: z
              .string()
              .nullable()
              .describe("Last annual review date"),
            meta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Organization metadata"),
            created: z.string().describe("Organization creation date"),
            updated: z.string().describe("Organization last updated date"),
            aoCount: z
              .number()
              .nullable()
              .describe("Number of AOs under this organization"),
          })
          .nullable()
          .describe("The created or updated organization"),
      }),
    )
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
          notifyMapDataChange({ type: "org.created", orgId: result.id });
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

      const isChangingParent =
        input.parentId !== undefined && input.parentId !== existingOrg.parentId;

      let destinationParentOrgId: number | null = null;

      if (isChangingParent) {
        if (input.parentId == null) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Parent ID is required to move this org",
          });
        }

        destinationParentOrgId = input.parentId;

        const destinationRoleCheckResult = await checkHasRoleOnOrg({
          orgId: destinationParentOrgId,
          session: ctx.session,
          db: ctx.db,
          roleName: "editor",
        });

        if (!destinationRoleCheckResult.success) {
          throw new ORPCError("UNAUTHORIZED", {
            message:
              "You are not authorized to move this org to the destination parent organization",
          });
        }
      }

      // If the parentId is changing and this is an AO, we need to move the locations for the org
      if (
        isChangingParent &&
        input.orgType === "ao" &&
        destinationParentOrgId !== null &&
        existingOrg.parentId !== null
      ) {
        await moveAOLocsToNewRegion(ctx, {
          oldRegionId: existingOrg.parentId,
          newRegionId: destinationParentOrgId,
          aoId: existingOrg.id,
        });
      }

      // 2. Update the org with the new values

      const orgToCrupdate: typeof schema.orgs.$inferInsert = {
        ...input,
        meta: input.meta,
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
        notifyMapDataChange({ type: "org.updated", orgId: result.id });
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
    .output(
      z.object({
        orgs: z
          .array(
            z.object({
              id: z.number().describe("Organization ID"),
              name: z.string().describe("Organization name"),
              orgType: z.enum(OrgType).describe("Organization type"),
              parentId: z
                .number()
                .nullable()
                .describe("Parent organization ID"),
              roles: z
                .array(z.string())
                .describe("Roles the user has on this organization"),
            }),
          )
          .describe("List of user's organizations"),
      }),
    )
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
        orgMap[orgId] ??= {
          orgs: row.orgs,
          roles_x_users_x_org: row.roles_x_users_x_org,
          roles: [],
        };
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
      z.object({
        id: z.coerce.number().describe("The ID of the organization to delete"),
        orgType: z
          .enum(OrgType)
          .optional()
          .describe("The type of the organization to delete"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["org"],
      summary: "Delete organization",
      description:
        "Soft delete an organization by marking it as inactive. This will also soft delete all associated event series and instances if the org is an AO.",
    })
    .output(
      z.object({
        orgId: z.number().describe("The ID of the deleted organization"),
      }),
    )
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

      // Get the org first to validate it exists and matches the provided type
      const [org] = await ctx.db
        .select({
          orgType: schema.orgs.orgType,
          isActive: schema.orgs.isActive,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.id));

      if (!org) {
        throw new ORPCError("NOT_FOUND", {
          message: "Organization not found",
        });
      }

      if (input.orgType && org.orgType !== input.orgType) {
        throw new ORPCError("CONFLICT", {
          message: `Organization type mismatch: expected ${input.orgType}, got ${org.orgType}`,
        });
      }

      if (!org.isActive) {
        throw new ORPCError("CONFLICT", {
          message: "Organization is already inactive",
        });
      }

      // Perform the soft delete with .returning() to confirm success
      const [deletedOrg] = await ctx.db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, input.id))
        .returning();

      if (!deletedOrg) {
        throw new ORPCError("NOT_FOUND", {
          message: "Organization not found",
        });
      }

      // If this is an AO, cascade soft-delete to series and event instances
      if (org.orgType === "ao") {
        const { softDeleteSeriesForOrg, softDeleteFutureInstancesForOrg } =
          await import("../lib/cascade-service");

        await softDeleteSeriesForOrg(ctx.db, input.id);
        await softDeleteFutureInstancesForOrg(ctx.db, input.id);
      }

      // Notify webhooks about the org deletion
      notifyMapDataChange({ type: "org.deleted", orgId: input.id });

      return { orgId: input.id };
    }),
};
