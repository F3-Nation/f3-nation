import { and, eq, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { ERRORS } from "@acme/shared/app/errors";
import { isValidEmail } from "@acme/shared/app/functions";
import type { UserRole } from "@acme/shared/app/enums";
import { normalizeEmail } from "@acme/shared/common/functions";
import { CrupdateUserSchema, UserSelectSchema } from "@acme/validators";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

interface RoleInput {
  orgId: number;
  roleName: UserRole;
}

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { logDebug, logError } from "../logger";
import {
  buildSingleUserQuery,
  buildUserListQuery,
  checkUserPiiAccess,
  isDuplicateEmailError,
  shapeUserPii,
  userDetailOutputSchema,
  userListInputSchema,
  userListUserOutputSchema,
} from "../lib/user";
import type { Context } from "../shared";
import { adminProcedure, editorProcedure } from "../shared";

const hasRoleOnAny = async (
  ctx: Context,
  orgIds: number[],
  roleName: "editor" | "admin",
): Promise<boolean> => {
  for (const orgId of new Set(orgIds)) {
    const { success } = await checkHasRoleOnOrg({
      orgId,
      session: ctx.session,
      db: ctx.db,
      roleName,
    });
    if (success) return true;
  }
  return false;
};

/**
 * Orgs whose editors may edit a user's profile: the home region, else any org
 * the user holds a role on, else the nation.
 */
const getProfileScopeOrgIds = async (
  ctx: Context,
  homeRegionId: number | null,
  roleOrgIds: number[],
): Promise<number[]> => {
  if (homeRegionId) return [homeRegionId];
  if (roleOrgIds.length > 0) return roleOrgIds;
  const nations = await ctx.db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "nation"));
  return nations.map(({ id }) => id);
};

const PII_FIELDS = new Set([
  "email",
  "phone",
  "emergencyContact",
  "emergencyPhone",
  "emergencyNotes",
]);

// Sorts keys at every depth so nested meta compares by content.
const sortedJson = (value: object) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );

// Forms send "" for an empty text field that is stored as null.
const isSameProfileValue = (submitted: unknown, stored: unknown) => {
  const a = submitted === "" ? null : submitted;
  const b = stored === "" ? null : stored;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "object" && typeof b === "object") {
    return sortedJson(a) === sortedJson(b);
  }
  return a === b;
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
    .output(
      z.object({
        users: z.array(userListUserOutputSchema),
        totalCount: z.number().describe("Total number of users"),
        includePii: z.boolean().describe("Whether PII fields are included"),
      }),
    )
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
    .output(
      z.object({
        users: z.array(userListUserOutputSchema),
        totalCount: z.number().describe("Total number of users"),
        includePii: z
          .boolean()
          .optional()
          .describe("Whether PII fields are included"),
      }),
    )
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
        includePii = true;
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
        id: z.coerce.number().describe("The unique identifier of the user"),
        includePii: z.coerce
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include personally identifiable information (email, phone, emergency contacts). Only available if requester is admin for a user's organization.",
          ),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["user"],
      summary: "Get user by ID",
      description:
        "Retrieve detailed information about a specific user including their roles, status, and organization assignments. PII fields (email, phone) are only included if the requester has admin role for any of the user's organizations.",
    })
    .output(
      z.object({
        user: userDetailOutputSchema.nullable(),
        includePii: z.boolean().describe("Whether PII fields are included"),
      }),
    )
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
        includeListFields: true,
      });
    }),
  byEmail: editorProcedure
    .input(
      z.object({
        email: z.email().describe("The email address of the user to retrieve"),
        includePii: z.coerce
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include personally identifiable information (email, phone, emergency contacts). Only available if requester is admin for a user's organization.",
          ),
      }),
    )
    .route({
      method: "GET",
      path: "/email/{email}",
      tags: ["user"],
      summary: "Get user by email",
      description:
        "Retrieve a user's detailed information and role assignments by email address. PII fields are only included if requester is admin for one of the user's organizations.",
    })
    .output(
      z.object({
        user: userDetailOutputSchema.nullable(),
        includePii: z.boolean().describe("Whether PII fields are included"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const normalizedEmail = normalizeEmail(input.email);
      let includePii = false;
      if (input?.includePii) {
        // First, get the user to check their orgs
        const [user] = await ctx.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, normalizedEmail));

        if (user) {
          includePii = await checkUserPiiAccess({
            ctx,
            userId: user.id,
          });
        }
      }

      return buildSingleUserQuery({
        ctx,
        whereCondition: eq(schema.users.email, normalizedEmail),
        includePii,
        includeEmail: true, // Always include email when searching by email
        includeListFields: true,
      });
    }),
  byF3Name: editorProcedure
    .input(
      z.object({
        f3Name: z
          .string()
          .describe(
            "Partial F3 name to search for. Case-insensitive partial matching.",
          ),
        pageIndex: z.coerce
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("Zero-based page index for pagination. Defaults to 0."),
        pageSize: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(10)
          .describe("Number of users per page. Defaults to 10."),
      }),
    )
    .route({
      method: "GET",
      path: "/f3name/{f3Name}",
      tags: ["user"],
      summary: "Search users by F3 name",
      description:
        "Search for users whose F3 name partially matches the input. Supports pagination and includes home region info.",
    })
    .output(
      z.object({
        users: z.array(userListUserOutputSchema),
        totalCount: z.number().describe("Total number of users"),
        includePii: z.boolean().describe("Whether PII fields are included"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      return buildUserListQuery({
        ctx,
        input: {
          searchTerm: input.f3Name,
          pageIndex: input.pageIndex,
          pageSize: input.pageSize,
          sorting: [{ id: "f3Name", desc: false }],
          includePii: false,
        },
        includePii: false,
      });
    }),
  crupdate: editorProcedure
    .input(CrupdateUserSchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["user"],
      summary: "Create or update user",
      description:
        "Create a new user or update an existing one, including role assignments for organizations. Requires admin role for organizations where roles are being assigned. PII fields (email, phone, emergency contacts) can only be set, and are only returned, if requester has admin access.",
    })
    .output(
      UserSelectSchema.partial({
        email: true,
        emailVerified: true,
        phone: true,
        emergencyContact: true,
        emergencyPhone: true,
        emergencyNotes: true,
      }).extend({
        roles: z
          .array(
            z.object({
              orgId: z.number().describe("Organization ID"),
              orgName: z.string().nullable().describe("Organization name"),
              roleName: z.string().nullable().describe("Role name"),
            }),
          )
          .describe("User roles"),
        meta: z
          .record(z.string(), z.unknown())
          .nullable()
          .optional()
          .describe("User metadata"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // emailVerified is set by the sign-in flow, never by callers.
      const { roles: rawRoles, emailVerified: _emailVerified, ...rest } = input;
      const roles = rawRoles as RoleInput[];

      const [existingUser] = input.id
        ? await ctx.db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, input.id))
        : [];
      if (input.id && !existingUser) {
        throw new ORPCError("NOT_FOUND", { message: "User not found" });
      }
      const existingRoles = input.id
        ? await ctx.db
            .select()
            .from(schema.rolesXUsersXOrg)
            .where(eq(schema.rolesXUsersXOrg.userId, input.id))
        : [];

      // An API key's session.id is its owner, so keys never edit "themselves".
      const isSelf =
        !ctx.session?.apiKey &&
        input.id !== undefined &&
        ctx.session?.id === input.id;

      const canEditProfile =
        isSelf ||
        !existingUser ||
        (await hasRoleOnAny(
          ctx,
          await getProfileScopeOrgIds(
            ctx,
            existingUser.homeRegionId,
            existingRoles.map((role) => role.orgId),
          ),
          "editor",
        ));

      // PII access: admin on any of an existing user's orgs, or on any org
      // being assigned to a new user.
      const piiOrgIds = existingUser
        ? existingRoles.map((role) => role.orgId)
        : roles.map((role) => role.orgId);
      const hasPiiAccess = await hasRoleOnAny(ctx, piiOrgIds, "admin");

      // Clients resend the whole form, so only reject fields that change.
      // PII without access, or sent as "", is never written, so skip it.
      if (existingUser && !canEditProfile) {
        const changesProfile = Object.entries(rest).some(([key, value]) => {
          if (key === "id" || value === undefined) return false;
          if (PII_FIELDS.has(key) && (!hasPiiAccess || value === "")) {
            return false;
          }
          const stored = existingUser[key as keyof typeof existingUser];
          if (key === "email" && typeof value === "string") {
            return normalizeEmail(value) !== normalizeEmail(existingUser.email);
          }
          return !isSameProfileValue(value, stored);
        });
        if (changesProfile) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "You are not authorized to edit this user's profile",
          });
        }
      }

      const newHomeRegionId = rest.homeRegionId;
      if (
        !isSelf &&
        canEditProfile &&
        newHomeRegionId != null &&
        newHomeRegionId !== existingUser?.homeRegionId &&
        !(await hasRoleOnAny(ctx, [newHomeRegionId], "editor"))
      ) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to set this home region",
        });
      }

      const dbRoles = await ctx.db.select().from(schema.roles);
      const roleNameToId = dbRoles.reduce(
        (acc, role) => {
          if (role.name) {
            acc[role.name] = role.id;
          }
          return acc;
        },
        {} as Record<string, number>,
      );

      const newRolesToInsert = roles.filter(
        (role) =>
          !existingRoles.some(
            (existingRole) =>
              existingRole.roleId === roleNameToId[role.roleName] &&
              existingRole.orgId === role.orgId,
          ),
      );
      logDebug("api.user.new_roles_to_insert", { newRolesToInsert });

      const rolesToDelete = existingRoles.filter(
        (existingRole) =>
          !roles.some(
            (role) =>
              roleNameToId[role.roleName] === existingRole.roleId &&
              role.orgId === existingRole.orgId,
          ),
      );
      logDebug("api.user.roles_to_delete", { rolesToDelete });

      const requireAdminOn = async (orgIds: number[], message: string) => {
        for (const orgId of orgIds) {
          if (!(await hasRoleOnAny(ctx, [orgId], "admin"))) {
            throw new ORPCError("UNAUTHORIZED", { message });
          }
        }
      };
      await requireAdminOn(
        newRolesToInsert.map((role) => role.orgId),
        ERRORS.MUST_BE_ADMIN_TO_GRANT_ROLES,
      );
      await requireAdminOn(
        rolesToDelete.map((role) => role.orgId),
        ERRORS.MUST_BE_ADMIN_TO_REMOVE_ROLES,
      );

      // Prepare update data - only include PII if user has access
      const {
        email: _email,
        phone: _phone,
        emergencyContact: _emergencyContact,
        emergencyPhone: _emergencyPhone,
        emergencyNotes: _emergencyNotes,
        ...nonPiiData
      } = rest;

      // Build updateSet based on access and whether values are provided
      let updateSet: typeof rest;
      if (input.id && !hasPiiAccess) {
        // Exclude PII fields for updates without access
        updateSet = nonPiiData;
      } else if (input.id) {
        // For updates with PII access, only include PII fields that are actually provided
        updateSet = {
          ...nonPiiData,
          ...(_email !== undefined &&
            _email !== "" && { email: normalizeEmail(_email) }),
          ...(_phone !== undefined && _phone !== "" && { phone: _phone }),
          ...(_emergencyContact !== undefined &&
            _emergencyContact !== "" && {
              emergencyContact: _emergencyContact,
            }),
          ...(_emergencyPhone !== undefined &&
            _emergencyPhone !== "" && { emergencyPhone: _emergencyPhone }),
          ...(_emergencyNotes !== undefined &&
            _emergencyNotes !== "" && { emergencyNotes: _emergencyNotes }),
        };
      } else {
        // For new users, include all fields
        updateSet = rest;
      }

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

      // Normalize email for case-insensitive storage and lookup
      const normalizedEmail = _email ? normalizeEmail(_email) : _email;

      logDebug("api.user.update_set", { updateFields: Object.keys(updateSet) });

      let user: typeof schema.users.$inferSelect;
      try {
        user = await ctx.db.transaction(async (tx) => {
          const transactionDb = tx as unknown as AppDb;
          let user: typeof schema.users.$inferSelect;

          if (input.id && !canEditProfile) {
            // Cannot edit profile data but can still manage roles.
            // Just fetch the existing user without modifying profile fields.
            const [existing] = await transactionDb
              .select()
              .from(schema.users)
              .where(eq(schema.users.id, input.id));
            if (!existing) {
              throw new ORPCError("NOT_FOUND", {
                message: "User not found",
              });
            }
            user = existing;
          } else {
            try {
              const result = await transactionDb
                .insert(schema.users)
                .values({
                  ...rest,
                  email: normalizedEmail ?? "",
                })
                .onConflictDoUpdate({
                  target: [schema.users.id],
                  set: updateSet,
                })
                .returning();

              const insertedUser = result[0];
              if (!insertedUser) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", {
                  message: "Failed to save user",
                });
              }
              user = insertedUser;
            } catch (error) {
              if (isDuplicateEmailError(error)) {
                throw new ORPCError("BAD_REQUEST", {
                  message: `A user with the email address "${_email ?? ""}" already exists. Please use a different email address.`,
                });
              }
              // The empty-result ORPCError thrown just above is already typed and
              // client-safe, so it passes through untouched.
              if (error instanceof ORPCError) throw error;
              // Anything else is an unexpected DB/driver fault. Rethrowing it raw
              // lets oRPC mask it as an opaque 500 and lose the cause, so log the
              // original and surface a generic message that leaks no internals.
              // No email in the log context — it is PII.
              logError("api.user.insert_failed", { userId: input.id }, error);
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Unable to save user",
              });
            }
          }

          logDebug("api.user.resolved_user", { userId: user.id });

          for (const role of rolesToDelete) {
            await transactionDb
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
            await transactionDb.insert(schema.rolesXUsersXOrg).values(
              newRolesToInsert.map((role) => {
                const roleId = roleNameToId[role.roleName];
                if (roleId === undefined) {
                  // roleName is schema-constrained to "user"/"editor"/"admin", so
                  // this only fires if the roles table is missing its seeded
                  // rows — a server data-integrity problem, not a client error.
                  throw new ORPCError("INTERNAL_SERVER_ERROR", {
                    message: `Role ${role.roleName} not found`,
                  });
                }
                return {
                  userId: user.id,
                  roleId,
                  orgId: role.orgId,
                };
              }),
            );
          }

          return user;
        });
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        logError("api.user.crupdate_tx_failed", { userId: input.id }, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unable to save user",
        });
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
        ...shapeUserPii(user, hasPiiAccess),
        roles: updatedRoles,
      };
    }),

  delete: adminProcedure
    .input(
      z.object({
        id: z.coerce
          .number()
          .describe("The unique identifier of the user to delete"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["user"],
      summary: "Delete user",
      description:
        "Permanently delete a user and all their role assignments. Requires F3 Nation admin role and cannot be undone.",
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
        throw new ORPCError("NOT_FOUND", {
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
