import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  and,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  schema as schemaRaw,
  sql,
} from "@acme/db";
import { UserRole, UserStatus } from "@acme/shared/app/enums";
import { CrupdateUserSchema, SortingSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getSortingColumns } from "../get-sorting-columns";
import { editorProcedure } from "../shared";
import { withPagination } from "../with-pagination";

const schema = { ...schemaRaw, users: schemaRaw.users };

export const userRouter = {
  all: editorProcedure
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
    .handler(async ({ context: ctx, input }) => {
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

      const userIdsQuery = ctx.db
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
    }),
  byId: editorProcedure
    .input(z.object({ id: z.number() }))
    .handler(async ({ context: ctx, input }) => {
      const [user] = await ctx.db
        .select({
          id: schema.users.id,
          f3Name: schema.users.f3Name,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          email: schema.users.email,
          status: schema.users.status,
          phone: schema.users.phone,
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
        })
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
        .groupBy(schema.users.id)
        .where(eq(schema.users.id, input.id));
      return user ?? null;
    }),
  crupdate: editorProcedure
    .input(CrupdateUserSchema)
    .handler(async ({ context: ctx, input }) => {
      const { roles, ...rest } = input;
      const [user] = await ctx.db
        .insert(schema.users)
        .values({
          ...rest,
        })
        .onConflictDoUpdate({
          target: [schema.users.id],
          set: input,
        })
        .returning();

      if (!user) {
        throw new Error("User not found");
      }

      const dbRoles = await ctx.db.select().from(schema.roles);

      const roleNameToId = dbRoles.reduce(
        (acc, role) => {
          if (role.name) {
            acc[role.name] = role.id;
          }
          return acc;
        },
        {} as Record<UserRole, number>,
      );

      const existingRoles = await ctx.db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, user.id));
      console.log("Existing roles", existingRoles);

      const newRolesToInsert = roles.filter(
        (role) =>
          !existingRoles.some(
            (existingRole) =>
              existingRole.roleId === roleNameToId[role.roleName] &&
              existingRole.orgId === role.orgId,
          ),
      );
      console.log("New roles to insert", newRolesToInsert);

      for (const role of newRolesToInsert) {
        const { success } = await checkHasRoleOnOrg({
          orgId: role.orgId,
          session: ctx.session,
          db: ctx.db,
          roleName: "admin",
        });
        if (!success) {
          throw new ORPCError("UNAUTHORIZED", {
            message:
              "You do not have permission to give this role to this user",
          });
        } else {
          console.log("User has role", success);
        }
      }

      const rolesToDelete = existingRoles.filter(
        (existingRole) =>
          !roles.some(
            (role) =>
              roleNameToId[role.roleName] === existingRole.roleId &&
              role.orgId === existingRole.orgId,
          ),
      );
      console.log("Roles to delete", rolesToDelete);

      for (const role of rolesToDelete) {
        const { success } = await checkHasRoleOnOrg({
          orgId: role.orgId,
          session: ctx.session,
          db: ctx.db,
          roleName: "admin",
        });
        if (!success) {
          throw new ORPCError("UNAUTHORIZED", {
            message:
              "You do not have permission to remove this role from this user",
          });
        } else {
          console.log("User has role", success);
        }

        await ctx.db
          .delete(schema.rolesXUsersXOrg)
          .where(
            and(
              eq(schema.rolesXUsersXOrg.userId, user.id),
              eq(schema.rolesXUsersXOrg.orgId, role.orgId),
              eq(schema.rolesXUsersXOrg.roleId, role.roleId),
            ),
          );
      }

      if (newRolesToInsert.length > 0) {
        await ctx.db.insert(schema.rolesXUsersXOrg).values(
          newRolesToInsert.map((role) => ({
            userId: user.id,
            roleId: roleNameToId[role.roleName],
            orgId: role.orgId,
          })),
        );
      }

      const updatedRoles = await ctx.db
        .select({
          orgId: schema.rolesXUsersXOrg.orgId,
          orgName: schema.orgs.name,
          roleName: schema.roles.name,
        })
        .from(schema.rolesXUsersXOrg)
        .leftJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
        .leftJoin(
          schema.roles,
          eq(schema.roles.id, schema.rolesXUsersXOrg.roleId),
        )
        .where(eq(schema.rolesXUsersXOrg.userId, user.id));

      return {
        ...user,
        roles: updatedRoles,
      };
    }),

  delete: editorProcedure
    .input(z.object({ id: z.number() }))
    .handler(async ({ context: ctx, input }) => {
      const [f3nationOrg] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "nation"),
            eq(schema.orgs.name, "F3 Nation"),
          ),
        )
        .limit(1);

      if (!f3nationOrg) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "No F3 Nation record is found.",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: f3nationOrg.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User doesn't have an Admin F3 Nation role.",
        });
      }

      await ctx.db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, input.id));

      await ctx.db.delete(schema.users).where(eq(schema.users.id, input.id));
    }),
};
