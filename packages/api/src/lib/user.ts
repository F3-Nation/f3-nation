import type { SQL } from "@acme/db";
import {
  aliasedTable,
  and,
  asc,
  count,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { UserRole, UserStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import { normalizeEmail } from "@acme/shared/common/functions";
import { UserSelectSchema } from "@acme/validators";
import type { UserSelectType } from "@acme/validators";
import { z } from "zod";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getSortingColumns } from "../get-sorting-columns";
import type { Context } from "../shared";
import { withPagination } from "../with-pagination";
import { resolvePagination } from "./pagination";

interface HomeRegionSummary {
  homeRegionId: number;
  homeRegionName: string | null;
}

interface BuildUserSelectParams {
  includePii: boolean;
  includeEmail?: boolean;
  includeListFields?: boolean;
  homeRegionOrg?: typeof schema.orgs;
}

interface HomeRegionSummary {
  homeRegionId: number;
  homeRegionName: string | null;
}

// Shared function to build user select fields
const buildUserSelect = ({
  includePii,
  includeEmail = false,
  includeListFields = false,
  homeRegionOrg,
}: BuildUserSelectParams) => {
  const _columns = getTableColumns(schema.users);
  type Columns = typeof _columns;

  // Base select fields (non-PII)
  let select: Pick<Columns, "id" | "status" | "created"> & {
    roles: SQL<{ orgId: number; orgName: string; roleName: UserRole }[]>;
    homeRegion?: SQL<HomeRegionSummary | null>;
  } & Partial<Columns> = {
    id: schema.users.id,
    f3Name: schema.users.f3Name,
    firstName: schema.users.firstName,
    lastName: schema.users.lastName,
    status: schema.users.status,
    roles: sql<
      { orgId: number; orgName: string; roleName: UserRole }[]
    >`COALESCE(
      json_agg(
        json_build_object(
          'orgId', ${schema.orgs.id}, 
          'orgName', ${schema.orgs.name}, 
          'roleName', ${schema.roles.name}
        )
      ) 
      FILTER (
        WHERE ${schema.orgs.id} IS NOT NULL
      ), 
      '[]'
    )`,
    created: schema.users.created,
    ...(includeListFields
      ? {
          ...(homeRegionOrg
            ? {
                homeRegion: sql<HomeRegionSummary | null>`CASE
                  WHEN ${schema.users.homeRegionId} IS NULL THEN NULL
                  ELSE json_build_object(
                    'homeRegionId', ${schema.users.homeRegionId},
                    'homeRegionName', ${homeRegionOrg.name}
                  )
                END`,
              }
            : {}),
          homeRegionId: schema.users.homeRegionId,
          avatarUrl: schema.users.avatarUrl,
          meta: schema.users.meta,
          updated: schema.users.updated,
        }
      : {}),
  };

  // Add PII fields if requested
  if (includePii) {
    select = {
      ...select,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      phone: schema.users.phone,
      emergencyContact: schema.users.emergencyContact,
      emergencyPhone: schema.users.emergencyPhone,
      emergencyNotes: schema.users.emergencyNotes,
    };
  } else if (includeEmail) {
    // Add only email if requested (without full PII)
    select = {
      ...select,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
    };
  }

  return select;
};

// Helper to check if error is a duplicate email constraint violation
export const isDuplicateEmailError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505" &&
    "constraint_name" in error &&
    (error as { constraint_name?: string }).constraint_name ===
      "users_email_key"
  );
};

// Base input schema object (before optional)
export const userListInputSchema = z.object({
  roles: arrayOrSingle(z.enum(UserRole))
    .optional()
    .describe(
      "Filter users by role(s). Matches users with ANY of the given roles (admin, editor, user).",
    ),
  searchTerm: z
    .string()
    .optional()
    .describe(
      "Search users by name, email, phone, or emergency contact information. Case-insensitive partial matching.",
    ),
  pageIndex: z.coerce
    .number()
    .optional()
    .describe(
      "Zero-based page index. Supplying this (or pageSize) opts into paginated results; omitting both returns every matching user.",
    ),
  pageSize: z.coerce
    .number()
    .optional()
    .describe(
      "Number of users per page. Defaults to 10. Supplying this (or pageIndex) opts into paginated results; omitting both returns every matching user.",
    ),
  sorting: parseSorting().describe(
    "Sort results by field(s). Format: [{ id: 'fieldName', desc: true/false }]. Available fields: id, f3Name, email, roles, status, created.",
  ),
  statuses: arrayOrSingle(z.enum(UserStatus))
    .optional()
    .describe(
      "Filter users by status(es). Matches users with ANY of the given statuses (active, inactive).",
    ),
  orgIds: arrayOrSingle(z.coerce.number())
    .optional()
    .describe(
      "Filter users by organization ID(s). Returns users with roles in ANY of the specified organizations.",
    ),
  homeRegionIds: arrayOrSingle(z.coerce.number())
    .optional()
    .describe(
      "Filter users by home region ID(s). Returns users whose home region matches ANY of the specified regions.",
    ),
  includePii: z.coerce
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Include personally identifiable information (email, phone, emergency contacts). Only available if requester is an F3 Nation admin.",
    ),
});

export const userListUserOutputSchema = UserSelectSchema.partial()
  .required({ id: true, status: true, created: true })
  .extend({
    roles: z
      .array(
        z.object({
          orgId: z.number().describe("Organization ID"),
          orgName: z.string().describe("Organization name"),
          roleName: z.enum(["user", "editor", "admin"]).describe("Role name"),
        }),
      )
      .describe("User roles"),
    name: z.string().describe("Full name (firstName + lastName)"),
    meta: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe("User metadata"),
    homeRegion: z
      .object({
        homeRegionId: z.number().describe("Home region ID"),
        homeRegionName: z
          .string()
          .nullable()
          .describe("Home region display name"),
      })
      .nullable()
      .optional()
      .describe("User's home region when set"),
  });

/** User shape for `byId`, `byEmail`, etc. (matches `buildSingleUserQuery`). */
export const userDetailOutputSchema = UserSelectSchema.partial()
  .required({ id: true })
  .extend({
    roles: z
      .array(
        z.object({
          orgId: z.number().describe("Organization ID"),
          orgName: z.string().describe("Organization name"),
          roleName: z.enum(["user", "editor", "admin"]).describe("Role name"),
        }),
      )
      .describe("User roles"),
    meta: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe("User metadata"),
    homeRegion: z
      .object({
        homeRegionId: z.number().describe("Home region ID"),
        homeRegionName: z
          .string()
          .nullable()
          .describe("Home region display name"),
      })
      .nullable()
      .optional()
      .describe("User's home region when set"),
    positions: z
      .array(
        z.object({
          positionId: z.number().describe("Position ID"),
          positionName: z.string().describe("Position name"),
          orgId: z.number().describe("Organization ID"),
          orgName: z.string().nullable().describe("Organization name"),
        }),
      )
      .describe("Positions held by the user"),
  });

// Shared query logic for list queries
export const buildUserListQuery = async ({
  ctx,
  input,
  includePii,
}: {
  ctx: Context;
  input: z.infer<typeof userListInputSchema>;
  includePii: boolean;
}) => {
  const { limit, offset, usePagination } = resolvePagination({
    pageSize: input?.pageSize,
    pageIndex: input?.pageIndex,
    defaultPageSize: 10,
  });
  const where = and(
    !input?.statuses?.length || input.statuses.length === UserStatus.length
      ? undefined
      : input.statuses.includes("active")
        ? eq(schema.users.status, "active")
        : eq(schema.users.status, "inactive"),
    !input?.roles?.length || input.roles.length === UserRole.length
      ? undefined
      : input.roles.includes("user")
        ? isNull(schema.roles.name)
        : inArray(schema.roles.name, input.roles),
    input?.searchTerm
      ? or(
          ilike(schema.users.f3Name, `%${input?.searchTerm}%`),
          ilike(schema.users.firstName, `%${input?.searchTerm}%`),
          ilike(schema.users.lastName, `%${input?.searchTerm}%`),
          includePii
            ? ilike(schema.users.email, `%${input?.searchTerm}%`)
            : eq(
                schema.users.email,
                input.searchTerm.includes("@")
                  ? normalizeEmail(input.searchTerm)
                  : input.searchTerm,
              ),
        )
      : undefined,
    input?.orgIds?.length
      ? or(
          inArray(schema.rolesXUsersXOrg.orgId, input.orgIds),
          and(
            isNull(schema.rolesXUsersXOrg.orgId),
            inArray(schema.users.homeRegionId, input.orgIds),
          ),
        )
      : undefined,
    input?.homeRegionIds?.length
      ? inArray(schema.users.homeRegionId, input.homeRegionIds)
      : undefined,
  );

  const homeRegion = aliasedTable(schema.orgs, "homeRegion");

  const sortedColumns = [
    ...getSortingColumns(
      input?.sorting,
      {
        id: schema.users.id,
        name: schema.users.firstName,
        f3Name: schema.users.f3Name,
        roles: sql`MIN(${schema.roles.name})`,
        status: schema.users.status,
        homeRegion: homeRegion.name,
        email: schema.users.email,
        phone: sql`NULLIF(${schema.users.phone}, '')`,
        regions: sql`MIN(${schema.orgs.name})`,
        created: schema.users.created,
      },
      "id",
      new Set(["homeRegion", "regions", "roles"] as const),
    ),
    // Always add id as a tiebreaker to ensure stable pagination order
    asc(schema.users.id),
  ];

  const userIdsQuery = ctx.db
    .selectDistinct({ id: schema.users.id })
    .from(schema.users)
    .leftJoin(
      schema.rolesXUsersXOrg,
      eq(schema.users.id, schema.rolesXUsersXOrg.userId),
    )
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(where);

  const countResult = await ctx.db
    .select({ count: count() })
    .from(userIdsQuery.as("distinct_users"));

  const userCount = countResult[0];
  const select = buildUserSelect({
    includePii,
    includeListFields: true, // Include list-specific fields
    homeRegionOrg: homeRegion,
  });

  const query = ctx.db
    .select(select)
    .from(schema.users)
    .leftJoin(
      schema.rolesXUsersXOrg,
      eq(schema.users.id, schema.rolesXUsersXOrg.userId),
    )
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .leftJoin(homeRegion, eq(homeRegion.id, schema.users.homeRegionId))
    .where(where)
    .groupBy(schema.users.id, homeRegion.id, homeRegion.name);

  const users = usePagination
    ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
    : await query.orderBy(...sortedColumns);

  return {
    users: users.map((user: (typeof users)[number]) => ({
      ...user,
      name: [user.firstName, user.lastName].join(" ").trim(),
      homeRegion: user.homeRegion ?? null,
    })),
    totalCount: userCount?.count ?? 0,
    includePii,
  };
};

// Shared query logic for single user queries (byId, byEmail)
interface BuildSingleUserQueryParams {
  ctx: Context;
  whereCondition: ReturnType<typeof eq>;
  includePii: boolean;
  includeEmail?: boolean;
  includeListFields?: boolean;
}
export const buildSingleUserQuery = async (
  params: BuildSingleUserQueryParams,
): Promise<{
  user:
    | (Pick<UserSelectType, "id"> & {
        roles: { orgId: number; orgName: string; roleName: UserRole }[];
        homeRegion?: HomeRegionSummary | null;
        positions: {
          positionId: number;
          positionName: string;
          orgId: number;
          orgName: string | null;
        }[];
      } & Partial<UserSelectType>)
    | null;
  includePii: boolean;
}> => {
  const {
    ctx,
    whereCondition,
    includePii,
    includeEmail = false,
    includeListFields = false,
  } = params;
  const homeRegion = aliasedTable(schema.orgs, "homeRegion");
  const select = buildUserSelect({
    includePii,
    includeEmail,
    includeListFields,
    homeRegionOrg: homeRegion,
  });

  const [user] = await ctx.db
    .select(select)
    .from(schema.users)
    .leftJoin(
      schema.rolesXUsersXOrg,
      eq(schema.users.id, schema.rolesXUsersXOrg.userId),
    )
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .leftJoin(homeRegion, eq(homeRegion.id, schema.users.homeRegionId))
    .where(whereCondition)
    .groupBy(schema.users.id, homeRegion.id, homeRegion.name);

  if (!user) {
    return { user: null, includePii };
  }

  const positionOrgs = aliasedTable(schema.orgs, "positionOrgs");
  const positions = await ctx.db
    .select({
      positionId: schema.positions.id,
      positionName: schema.positions.name,
      orgId: schema.positionsXOrgsXUsers.orgId,
      orgName: positionOrgs.name,
    })
    .from(schema.positionsXOrgsXUsers)
    .innerJoin(
      schema.positions,
      eq(schema.positions.id, schema.positionsXOrgsXUsers.positionId),
    )
    .leftJoin(
      positionOrgs,
      eq(positionOrgs.id, schema.positionsXOrgsXUsers.orgId),
    )
    .where(eq(schema.positionsXOrgsXUsers.userId, user.id));

  return {
    user: {
      ...user,
      homeRegion: user.homeRegion ?? null,
      positions,
    },
    includePii,
  };
};

// Helper to check PII access for a user
export const checkUserPiiAccess = async ({
  ctx,
  userId,
}: {
  ctx: Context;
  userId: number;
}): Promise<boolean> => {
  // Get the user's orgs to check if requester is admin of any
  const userOrgs = await ctx.db
    .selectDistinct({
      orgId: schema.rolesXUsersXOrg.orgId,
    })
    .from(schema.rolesXUsersXOrg)
    .where(eq(schema.rolesXUsersXOrg.userId, userId));

  // Check if requester is an admin for any of the user's orgs
  for (const userOrg of userOrgs) {
    const { success } = await checkHasRoleOnOrg({
      orgId: userOrg.orgId,
      session: ctx.session,
      db: ctx.db,
      roleName: "admin",
    });
    if (success) {
      return true;
    }
  }

  return false;
};
