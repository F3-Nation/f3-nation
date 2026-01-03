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
import {
  arrayOrSingle,
  isValidEmail,
  parseSorting,
} from "@acme/shared/app/functions";
import { CrupdateUserSchema } from "@acme/validators";

import type { Context } from "../shared";
import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { adminProcedure, editorProcedure } from "../shared";
import { withPagination } from "../with-pagination";

const schema = { ...schemaRaw, users: schemaRaw.users };

// Helper to check if error is a duplicate email constraint violation
const isDuplicateEmailError = (error: unknown): boolean => {
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
const userListInputSchema = z.object({
  roles: arrayOrSingle(z.enum(UserRole)).optional(),
  searchTerm: z.string().optional(),
  pageIndex: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sorting: parseSorting(),
  statuses: arrayOrSingle(z.enum(UserStatus)).optional(),
  orgIds: arrayOrSingle(z.coerce.number()).optional(),
  includePii: z.coerce.boolean().optional().default(false),
});

// Shared query logic
const buildUserListQuery = async ({
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
            : eq(schema.users.email, input?.searchTerm ?? ""),
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

  // Base select fields (non-PII)
  const baseSelect = {
    id: schema.users.id,
    f3Name: schema.users.f3Name,
    firstName: schema.users.firstName,
    lastName: schema.users.lastName,
    homeRegionId: schema.users.homeRegionId,
    avatarUrl: schema.users.avatarUrl,
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

  // Add PII fields if includePii is true
  const select = includePii
    ? {
        ...baseSelect,
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        phone: schema.users.phone,
        emergencyContact: schema.users.emergencyContact,
        emergencyPhone: schema.users.emergencyPhone,
        emergencyNotes: schema.users.emergencyNotes,
      }
    : baseSelect;

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
      name: `${user.firstName} ${user.lastName}`,
    })),
    totalCount: userCount?.count ?? 0,
    includePii,
  };
};

export const userRouter = {
  all: editorProcedure
    .input(userListInputSchema)
    .route({
      method: "GET",
      path: "/",
      tags: ["user"],
      summary: "List all users",
      description:
        "Get a paginated list of users with optional filtering by role, status, and organization. Includes PII fields (email, phone, emergency contacts) if includePii is true and the user is an F3 Nation admin.",
    })
    .handler(async ({ context: ctx, input }) => {
      // Always set to false by default
      let includePii = false;

      if (input?.includePii) {
        const [nation] = await ctx.db
          .select({ id: schema.orgs.id })
          .from(schema.orgs)
          .where(eq(schema.orgs.orgType, "nation"));

        if (!nation) {
          throw new ORPCError("NOT_FOUND", {
            message: "Nation not found",
          });
        }

        const { success } = await checkHasRoleOnOrg({
          orgId: nation.id,
          session: ctx.session,
          db: ctx.db,
          roleName: "admin",
        });
        if (!success) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "You do not have permission to view PII",
          });
        }
        includePii = true;
      }

      return buildUserListQuery({ ctx, input, includePii });
    }),
  byOrgs: editorProcedure
    .input(userListInputSchema)
    .route({
      method: "GET",
      path: "/orgs",
      tags: ["user"],
      summary: "List users by organization",
      description:
        "Get a paginated list of users associated with the specified organizations and all their descendant organizations through their roles. PII fields (email, phone, emergency contacts) are only included if the requester is an admin for all of the specified organizations.",
    })
    .handler(async ({ context: ctx, input }) => {
      if (!input?.orgIds || input.orgIds.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "At least one orgId is required",
        });
      }

      // Get all descendant org IDs (including the requested orgs themselves)
      const allOrgIds = await getDescendantOrgIds(ctx.db, input.orgIds);

      if (allOrgIds.length === 0) {
        return {
          users: [],
          totalCount: 0,
        };
      }

      // Always set to false by default
      let includePii = false;

      if (input?.includePii) {
        // Check if user is an admin for all of the specified parent orgs
        // (not all descendants, just the ones they requested)
        for (const orgId of input.orgIds) {
          const { success } = await checkHasRoleOnOrg({
            orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "admin",
          });
          if (!success) {
            includePii = false;
            break;
          }
        }
        includePii = true;
      }

      // Update input to use all descendant org IDs
      const inputWithDescendants = {
        ...input,
        orgIds: allOrgIds,
      };

      return buildUserListQuery({
        ctx,
        input: inputWithDescendants,
        includePii,
      });
    }),
  byId: editorProcedure
    .input(
      z.object({
        id: z.coerce.number(),
        includePii: z.coerce.boolean().optional().default(false),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["user"],
      summary: "Get user by ID",
      description:
        "Retrieve detailed information about a specific user including their roles. PII fields (email, phone) are only included if the requested user belongs to an organization where the requester is an admin.",
    })
    .handler(async ({ context: ctx, input }) => {
      let includePii = false;
      if (input?.includePii) {
        // First, get the user's orgs to check if requester is admin of any
        const userOrgs = await ctx.db
          .selectDistinct({
            orgId: schema.rolesXUsersXOrg.orgId,
          })
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, input.id));

        // Check if requester is an admin for any of the user's orgs
        for (const userOrg of userOrgs) {
          const { success } = await checkHasRoleOnOrg({
            orgId: userOrg.orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "admin",
          });
          if (success) {
            includePii = true;
            break;
          }
        }
      }

      // Base select fields (non-PII)
      const baseSelect = {
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
      };

      // Add PII fields if requester is admin for any of the user's orgs
      const select = includePii
        ? {
            ...baseSelect,
            email: schema.users.email,
            phone: schema.users.phone,
          }
        : baseSelect;

      // Set type so that it is not a union
      let user:
        | {
            id: number;
            email?: string;
            phone?: string | null;
            f3Name: string | null;
            firstName: string | null;
            lastName: string | null;
            status: "active" | "inactive";
            roles: {
              orgId: number;
              orgName: string;
              roleName: UserRole;
            }[];
          }
        | undefined = undefined;

      const [userResult] = await ctx.db
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
        .groupBy(schema.users.id)
        .where(eq(schema.users.id, input.id));

      user = userResult;

      return {
        user: user ?? null,
        includePii,
      };
    }),
  crupdate: adminProcedure
    .input(CrupdateUserSchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["user"],
      summary: "Create or update user",
      description:
        "Create a new user or update an existing one, including role assignments. PII fields (email, phone) are only updated if the requester has admin access to the user's organizations.",
    })
    .handler(async ({ context: ctx, input }) => {
      const { roles, ...rest } = input;

      // Check if this is an update (has id) and if requester has PII access
      let hasPiiAccess = false;
      if (input.id) {
        // Get the user's orgs to check if requester is admin of any
        const userOrgs = await ctx.db
          .selectDistinct({
            orgId: schema.rolesXUsersXOrg.orgId,
          })
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, input.id));

        // Check if requester is an admin for any of the user's orgs
        for (const userOrg of userOrgs) {
          const { success } = await checkHasRoleOnOrg({
            orgId: userOrg.orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "admin",
          });
          if (success) {
            hasPiiAccess = true;
            break;
          }
        }
      } else {
        // For new users, check if requester has admin access to the orgs being assigned
        for (const role of roles) {
          const { success } = await checkHasRoleOnOrg({
            orgId: role.orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "admin",
          });
          if (success) {
            hasPiiAccess = true;
            break;
          }
        }
      }

      // Prepare update data - only include PII if user has access
      const {
        email: _email,
        phone: _phone,
        emergencyContact: _emergencyContact,
        emergencyPhone: _emergencyPhone,
        emergencyNotes: _emergencyNotes,
        ...nonPiiData
      } = rest;

      const updateSet =
        input.id && !hasPiiAccess
          ? nonPiiData // Exclude PII fields for updates without access
          : rest; // Include all fields for new users or users with access

      if (!input.id && !_email) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Email is required for new users",
        });
      }

      if (!isValidEmail(_email)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Invalid email format",
        });
      }

      console.log("Update set", updateSet);

      let user: typeof schema.users.$inferSelect;
      try {
        const result = await ctx.db
          .insert(schema.users)
          .values({
            ...rest,
            email: _email ?? "", // Ensure required email is not undefined
          })
          .onConflictDoUpdate({
            target: [schema.users.id],
            set: updateSet,
          })
          .returning();

        const insertedUser = result[0];
        if (!insertedUser) {
          throw new Error("User not found");
        }
        user = insertedUser;
      } catch (error) {
        if (isDuplicateEmailError(error)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `A user with the email address "${_email}" already exists. Please use a different email address.`,
          });
        }
        // Re-throw other errors
        throw error;
      }

      console.log("User", user);

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

      console.log("New roles to insert", newRolesToInsert);
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

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["user"],
      summary: "Delete user",
      description:
        "Permanently delete a user and all their role assignments (requires nation admin)",
    })
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
          message: "You must be an F3 Nation admin to delete users.",
        });
      }

      await ctx.db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, input.id));

      await ctx.db.delete(schema.users).where(eq(schema.users.id, input.id));
    }),
};
