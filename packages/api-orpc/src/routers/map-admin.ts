import { z } from "zod";

import {
  and,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { UserRole, UserStatus } from "@acme/shared/app/enums";
import { SortingSchema } from "@acme/validators";

import { getSortingColumns } from "../get-sorting-columns";
import { editorOp } from "../shared";
import { withPagination } from "../with-pagination";

export const map_admin_users_all = editorOp
  .input(
    z
      .object({
        roles: z.array(z.enum(UserRole)).optional(),
        searchTerm: z.string().optional(),
        pageIndex: z.number().optional(),
        pageSize: z.number().optional(),
        sorting: SortingSchema.optional(),
        statuses: z.array(z.enum(UserStatus)).optional(),
        orgIds: z.number().array().optional(),
      })
      .optional(),
  )
  .handler(async ({ context, input }) => {
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
            ilike(schema.users.email, `%${input?.searchTerm}%`),
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

    const select = {
      id: schema.users.id,
      f3Name: schema.users.f3Name,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      phone: schema.users.phone,
      homeRegionId: schema.users.homeRegionId,
      avatarUrl: schema.users.avatarUrl,
      emergencyContact: schema.users.emergencyContact,
      emergencyPhone: schema.users.emergencyPhone,
      emergencyNotes: schema.users.emergencyNotes,
      status: schema.users.status,
      meta: schema.users.meta,
      created: schema.users.created,
      updated: schema.users.updated,
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
    };

    const userIdsQuery = context.db
      .selectDistinct({ id: schema.users.id })
      .from(schema.users)
      .leftJoin(
        schema.rolesXUsersXOrg,
        eq(schema.users.id, schema.rolesXUsersXOrg.userId),
      )
      .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
      .leftJoin(
        schema.roles,
        eq(schema.roles.id, schema.rolesXUsersXOrg.roleId),
      )
      .where(where);

    const countResult = await context.db
      .select({ count: count() })
      .from(userIdsQuery.as("distinct_users"));

    const userCount = countResult[0];

    const query = context.db
      .select(select)
      .from(schema.users)
      .leftJoin(
        schema.rolesXUsersXOrg,
        eq(schema.users.id, schema.rolesXUsersXOrg.userId),
      )
      .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
      .leftJoin(
        schema.roles,
        eq(schema.roles.id, schema.rolesXUsersXOrg.roleId),
      )
      .where(where)
      .groupBy(schema.users.id);

    const users = usePagination
      ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
      : await query;

    return {
      users: users.map((user) => ({
        ...user,
        name: `${user.firstName} ${user.lastName}`,
      })),
      totalCount: userCount?.count ?? 0,
    };
  });
