import type { SQL } from "@acme/db";
import {
  and,
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
import type { UserSelectType } from "@acme/validators";
import { z } from "zod";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getSortingColumns } from "../get-sorting-columns";
import type { Context } from "../shared";
import { withPagination } from "../with-pagination";

interface BuildUserSelectParams {
  includePii: boolean;
  includeEmail?: boolean;
  includeListFields?: boolean;
}

// Shared function to build user select fields
export const buildUserSelect = ({
  includePii,
  includeEmail = false,
  includeListFields = false,
}: BuildUserSelectParams) => {
  const columns = getTableColumns(schema.users);
  type Columns = typeof columns;

  // Base select fields (non-PII)
  let select: Pick<Columns, "id" | "status" | "created"> & {
    roles: SQL<{ orgId: number; orgName: string; roleName: UserRole }[]>;
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
    .describe("Zero-based page index for pagination. Defaults to 0."),
  pageSize: z.coerce
    .number()
    .optional()
    .describe("Number of users per page. Defaults to 10."),
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
  includePii: z.coerce
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Include personally identifiable information (email, phone, emergency contacts). Only available if requester is an F3 Nation admin.",
    ),
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
  const limit = input?.pageSize ?? 10;
  const offset = (input?.pageIndex ?? 0) * limit;
  const usePagination =
    input?.pageIndex !== undefined && input?.pageSize !== undefined;
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
                (input?.searchTerm ?? "").includes("@")
                  ? normalizeEmail(input.searchTerm!)
                  : input?.searchTerm ?? "",
              ),
        )
      : undefined,
    input?.orgIds?.length
      ? inArray(schema.rolesXUsersXOrg.orgId, input.orgIds)
      : undefined,
  );

  const sortedColumns = getSortingColumns(
    input?.sorting,
    {
      id: schema.users.id,
      name: schema.users.firstName,
      f3Name: schema.users.f3Name,
      roles: schema.roles.name,
      status: schema.users.status,
      email: schema.users.email,
      phone: schema.users.phone,
      regions: schema.orgs.name,
      created: schema.users.created,
    },
    "id",
  );

  const select = buildUserSelect({
    includePii,
    includeListFields: true, // Include list-specific fields
  });

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

  const query = ctx.db
    .select(select)
    .from(schema.users)
    .leftJoin(
      schema.rolesXUsersXOrg,
      eq(schema.users.id, schema.rolesXUsersXOrg.userId),
    )
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .leftJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(where)
    .groupBy(schema.users.id);

  const users = usePagination
    ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
    : await query.orderBy(...sortedColumns);

  return {
    users: users.map((user: (typeof users)[number]) => ({
      ...user,
      name: [user.firstName, user.lastName].join(" ").trim(),
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
}
export const buildSingleUserQuery = async (
  params: BuildSingleUserQueryParams,
): Promise<{
  user:
    | (Pick<UserSelectType, "id"> & {
        roles: { orgId: number; orgName: string; roleName: UserRole }[];
      } & Partial<UserSelectType>)
    | null;
  includePii: boolean;
}> => {
  const { ctx, whereCondition, includePii, includeEmail = false } = params;
  const select = buildUserSelect({
    includePii,
    includeEmail,
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
    .where(whereCondition)
    .groupBy(schema.users.id);

  return {
    user: user ?? null,
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
