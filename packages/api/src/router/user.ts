import { and, eq, schema } from "@acme/db";
import type { UserRole } from "@acme/shared/app/enums";
import { isValidEmail } from "@acme/shared/app/functions";
import { CrupdateUserSchema } from "@acme/validators";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import {
  buildSingleUserQuery,
  buildUserListQuery,
  checkUserPiiAccess,
  isDuplicateEmailError,
  userListInputSchema,
} from "../lib/user";
import { adminProcedure, editorProcedure } from "../shared";

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

      return buildSingleUserQuery({
        ctx,
        whereCondition: eq(schema.users.id, input.id),
        includePii,
      });
    }),
  byEmail: editorProcedure
    .input(
      z.object({
        email: z.string().email(),
        includePii: z.coerce.boolean().optional().default(false),
      }),
    )
    .route({
      method: "GET",
      path: "/email/{email}",
      tags: ["user"],
      summary: "Get user by email",
      description:
        "Retrieve a user by their email address. PII fields (email, phone) are only included if the requested user belongs to an organization where the requester is an admin.",
    })
    .handler(async ({ context: ctx, input }) => {
      let includePii = false;
      if (input?.includePii) {
        // First, get the user to check their orgs
        const [user] = await ctx.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, input.email));

        if (user) {
          includePii = await checkUserPiiAccess({
            ctx,
            userId: user.id,
          });
        }
      }

      return buildSingleUserQuery({
        ctx,
        whereCondition: eq(schema.users.email, input.email),
        includePii,
        includeEmail: true, // Always include email when searching by email
      });
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

      // Only validate email format if email is provided (required for new users, optional for updates)
      if (_email && !isValidEmail(_email)) {
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
