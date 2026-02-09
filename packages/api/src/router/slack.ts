import { z } from "zod";

import { and, eq, ilike, inArray, isNotNull, or, schema } from "@acme/db";
import { SlackSettingsSchema, SlackUserUpsertSchema } from "@acme/validators";

import { apiKeyProcedure, publicProcedure } from "../shared";

export const slackRouter = {
  getSpace: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .route({
      method: "GET",
      path: "/space",
      tags: ["slack"],
      summary: "Get Slack space settings",
      description:
        "Retrieve settings and tokens for a specific Slack workspace",
    })
    .handler(async ({ context: ctx, input }) => {
      const [space] = await ctx.db
        .select()
        .from(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, input.teamId));
      return space ?? null;
    }),

  updateSpaceSettings: apiKeyProcedure
    .input(
      z.object({
        teamId: z.string(),
        settings: SlackSettingsSchema,
      }),
    )
    .route({
      method: "PATCH",
      path: "/space/settings",
      tags: ["slack"],
      summary: "Update Slack space settings",
      description: "Update settings for a specific Slack workspace",
    })
    .handler(async ({ context: ctx, input }) => {
      const [space] = await ctx.db
        .select()
        .from(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      if (!space) {
        throw new Error("Slack space not found");
      }

      const updatedSettings = {
        ...(space.settings as Record<string, unknown>),
        ...input.settings,
      };

      await ctx.db
        .update(schema.slackSpaces)
        .set({ settings: updatedSettings })
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      return { success: true };
    }),

  getUserBySlackId: publicProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
      }),
    )
    .route({
      method: "GET",
      path: "/user",
      tags: ["slack"],
      summary: "Get user by Slack ID",
      description: "Retrieve a user record using their Slack ID and team ID",
    })
    .handler(async ({ context: ctx, input }) => {
      // Find the slack user for this specific team
      const [slackUser] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(
          and(
            eq(schema.slackUsers.slackId, input.slackId),
            eq(schema.slackUsers.slackTeamId, input.teamId),
          ),
        );

      if (!slackUser) return null;

      // Also get the user info from users table if it exists
      if (slackUser.userId) {
        const [user] = await ctx.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, slackUser.userId));
        return { ...slackUser, user };
      }

      return slackUser;
    }),

  upsertUser: apiKeyProcedure
    .input(SlackUserUpsertSchema)
    .route({
      method: "PUT",
      path: "/user",
      tags: ["slack"],
      summary: "Upsert Slack user",
      description: "Create or update a Slack user record",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, input.slackId));

      if (existing) {
        await ctx.db
          .update(schema.slackUsers)
          .set({
            userName: input.userName,
            email: input.email ?? existing.email,
            userId: input.userId ?? existing.userId,
            isAdmin: input.isAdmin,
            isOwner: input.isOwner,
            isBot: input.isBot,
          })
          .where(eq(schema.slackUsers.slackId, input.slackId));
        return { success: true, action: "updated" };
      }

      await ctx.db.insert(schema.slackUsers).values({
        slackId: input.slackId,
        userName: input.userName,
        email: input.email ?? "",
        userId: input.userId,
        slackTeamId: input.teamId,
        isAdmin: input.isAdmin,
        isOwner: input.isOwner,
        isBot: input.isBot,
      });

      return { success: true, action: "created" };
    }),

  getOrCreateSpace: apiKeyProcedure
    .input(
      z.object({
        teamId: z.string(),
        workspaceName: z.string().optional(),
        botToken: z.string().optional(),
      }),
    )
    .route({
      method: "POST",
      path: "/get-or-create-space",
      tags: ["slack"],
      summary: "Get or create Slack space",
      description:
        "Retrieve slack space settings or create a new record if it doesn't exist",
    })
    .handler(async ({ context: ctx, input }) => {
      const [space] = await ctx.db
        .select()
        .from(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      if (space) {
        return space;
      }

      const [newSpace] = await ctx.db
        .insert(schema.slackSpaces)
        .values({
          teamId: input.teamId,
          workspaceName: input.workspaceName ?? null,
          botToken: input.botToken ?? null,
          settings: {},
        })
        .returning();

      return newSpace;
    }),

  getOrCreateUser: apiKeyProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
        userName: z.string(),
        email: z.string().optional(),
        isAdmin: z.boolean().optional(),
        isOwner: z.boolean().optional(),
        isBot: z.boolean().optional(),
        avatarUrl: z.string().optional(),
      }),
    )
    .route({
      method: "POST",
      path: "/get-or-create-user",
      tags: ["slack"],
      summary: "Get or create Slack user",
      description:
        "Retrieve a Slack user record or create a new one if it doesn't exist",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, input.slackId));

      if (existing) {
        return existing;
      }

      const [newUser] = await ctx.db
        .insert(schema.slackUsers)
        .values({
          slackId: input.slackId,
          userName: input.userName,
          email: input.email ?? "",
          slackTeamId: input.teamId,
          isAdmin: input.isAdmin ?? false,
          isOwner: input.isOwner ?? false,
          isBot: input.isBot ?? false,
          avatarUrl: input.avatarUrl ?? null,
        })
        .returning();

      return newUser;
    }),

  /**
   * Get or create a Slack user with a guaranteed linked F3 user.
   * If the Slack user doesn't exist, creates it.
   * If the F3 user doesn't exist for the email, creates it.
   * Always returns a Slack user with a valid userId linking to an F3 user.
   */
  getOrCreateLinkedUser: apiKeyProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
        userName: z.string(),
        email: z.string().email(),
        isAdmin: z.boolean().optional(),
        isOwner: z.boolean().optional(),
        isBot: z.boolean().optional(),
        avatarUrl: z.string().optional(),
      }),
    )
    .route({
      method: "POST",
      path: "/get-or-create-linked-user",
      tags: ["slack"],
      summary: "Get or create Slack user with linked F3 user",
      description:
        "Retrieve or create a Slack user record with a guaranteed linked F3 user. If no F3 user exists for the email, one will be created.",
    })
    .handler(async ({ context: ctx, input }) => {
      // Step 1: Find or create the Slack user for this specific team
      let [slackUser] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(
          and(
            eq(schema.slackUsers.slackId, input.slackId),
            eq(schema.slackUsers.slackTeamId, input.teamId),
          ),
        );

      if (!slackUser) {
        // Create the Slack user for this team (without userId for now)
        [slackUser] = await ctx.db
          .insert(schema.slackUsers)
          .values({
            slackId: input.slackId,
            userName: input.userName,
            email: input.email,
            slackTeamId: input.teamId,
            isAdmin: input.isAdmin ?? false,
            isOwner: input.isOwner ?? false,
            isBot: input.isBot ?? false,
            avatarUrl: input.avatarUrl ?? null,
          })
          .returning();
      }

      // Step 2: Ensure F3 user exists and is linked
      if (!slackUser!.userId) {
        // Try to find an existing F3 user by email
        let [f3User] = await ctx.db
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, input.email));

        if (!f3User) {
          // Create a new F3 user
          // Parse the userName to extract first/last name if possible
          const nameParts = input.userName.trim().split(/\s+/);
          const firstName = nameParts[0] ?? input.userName;
          const lastName =
            nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

          // For bots or single-word names, use userName as f3Name
          const f3Name =
            (input.isBot ?? false) || nameParts.length === 1
              ? input.userName
              : null;

          [f3User] = await ctx.db
            .insert(schema.users)
            .values({
              email: input.email,
              firstName,
              lastName,
              f3Name,
              avatarUrl: input.avatarUrl ?? null,
              // emailVerified is null - user hasn't verified their email
              // status defaults to 'active'
            })
            .returning();
        }

        // Link the Slack user to the F3 user
        await ctx.db
          .update(schema.slackUsers)
          .set({ userId: f3User!.id })
          .where(eq(schema.slackUsers.id, slackUser!.id));

        // Update our local reference
        slackUser = { ...slackUser!, userId: f3User!.id };
      }

      // Return the Slack user with guaranteed userId
      return {
        ...slackUser!,
        // Explicitly include userId to satisfy the type
        userId: slackUser!.userId!,
      };
    }),

  /**
   * Get the org associated with a Slack workspace.
   * The org can be any type (region, area, etc.) depending on how the workspace was configured.
   */
  getOrg: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .route({
      method: "GET",
      path: "/org",
      tags: ["slack"],
      summary: "Get org for Slack space",
      description:
        "Retrieve the org associated with a Slack workspace. Returns the org ID, name, type, and space details.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select({
          org: {
            id: schema.orgs.id,
            name: schema.orgs.name,
            orgType: schema.orgs.orgType,
            parentId: schema.orgs.parentId,
          },
          space: schema.slackSpaces,
        })
        .from(schema.slackSpaces)
        .innerJoin(
          schema.orgsXSlackSpaces,
          eq(schema.orgsXSlackSpaces.slackSpaceId, schema.slackSpaces.id),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.orgsXSlackSpaces.orgId),
        )
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      return result ?? null;
    }),

  /**
   * @deprecated Use getOrg instead
   */
  getRegion: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .route({
      method: "GET",
      path: "/region",
      tags: ["slack"],
      summary: "Get region for Slack space (deprecated)",
      description:
        "Deprecated: Use /slack/org instead. Retrieve the org associated with a Slack workspace.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select({
          org: {
            id: schema.orgs.id,
            name: schema.orgs.name,
            orgType: schema.orgs.orgType,
          },
          space: schema.slackSpaces,
        })
        .from(schema.slackSpaces)
        .innerJoin(
          schema.orgsXSlackSpaces,
          eq(schema.orgsXSlackSpaces.slackSpaceId, schema.slackSpaces.id),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.orgsXSlackSpaces.orgId),
        )
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      return result ?? null;
    }),

  /**
   * Check if a Slack user has a specific role on the region org associated with their Slack workspace.
   * This checks the F3 role system (rolesXUsersXOrg), not Slack's admin/owner flags.
   */
  checkUserRole: apiKeyProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
        roleName: z
          .enum(["user", "editor", "admin"])
          .optional()
          .default("admin"),
      }),
    )
    .route({
      method: "GET",
      path: "/check-role",
      tags: ["slack"],
      summary: "Check user role on region",
      description:
        "Check if a Slack user has a specific F3 role on the region org associated with their workspace",
    })
    .handler(async ({ context: ctx, input }) => {
      // First, find the slack user and their linked F3 user
      const [slackUser] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, input.slackId));

      if (!slackUser?.userId) {
        return {
          hasRole: false,
          reason: "no-f3-user-linked",
          userId: null,
          orgId: null,
        };
      }

      // Find the region org associated with this Slack workspace
      const [regionResult] = await ctx.db
        .select({
          orgId: schema.orgs.id,
          orgName: schema.orgs.name,
        })
        .from(schema.slackSpaces)
        .innerJoin(
          schema.orgsXSlackSpaces,
          eq(schema.orgsXSlackSpaces.slackSpaceId, schema.slackSpaces.id),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.orgsXSlackSpaces.orgId),
        )
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      if (!regionResult) {
        return {
          hasRole: false,
          reason: "no-region-linked",
          userId: slackUser.userId,
          orgId: null,
        };
      }

      // Get the role ID for the requested role
      const [role] = await ctx.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, input.roleName));

      if (!role) {
        return {
          hasRole: false,
          reason: "role-not-found",
          userId: slackUser.userId,
          orgId: regionResult.orgId,
        };
      }

      // Check if the user has the role on this org
      const [userRole] = await ctx.db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(
          and(
            eq(schema.rolesXUsersXOrg.userId, slackUser.userId),
            eq(schema.rolesXUsersXOrg.orgId, regionResult.orgId),
            eq(schema.rolesXUsersXOrg.roleId, role.id),
          ),
        );

      if (userRole) {
        return {
          hasRole: true,
          reason: "direct-permission",
          userId: slackUser.userId,
          orgId: regionResult.orgId,
          roleName: input.roleName,
        };
      }

      // Check if user has admin role on any ancestor org (region -> sector -> area -> nation)
      // This allows nation/area/sector admins to manage regions
      const [orgHierarchy] = await ctx.db
        .select({
          parentId: schema.orgs.parentId,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, regionResult.orgId));

      const ancestorIds: number[] = [];
      let currentParentId = orgHierarchy?.parentId;

      // Walk up the org hierarchy
      while (currentParentId) {
        ancestorIds.push(currentParentId);
        const [parent] = await ctx.db
          .select({ parentId: schema.orgs.parentId })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, currentParentId));
        currentParentId = parent?.parentId;
      }

      if (ancestorIds.length > 0) {
        // Check if user has admin role on any ancestor org
        const [adminRole] = await ctx.db
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.name, "admin"));

        if (adminRole) {
          for (const ancestorId of ancestorIds) {
            const [ancestorRole] = await ctx.db
              .select()
              .from(schema.rolesXUsersXOrg)
              .where(
                and(
                  eq(schema.rolesXUsersXOrg.userId, slackUser.userId),
                  eq(schema.rolesXUsersXOrg.orgId, ancestorId),
                  eq(schema.rolesXUsersXOrg.roleId, adminRole.id),
                ),
              );

            if (ancestorRole) {
              return {
                hasRole: true,
                reason: "ancestor-admin",
                userId: slackUser.userId,
                orgId: ancestorId,
                roleName: "admin",
              };
            }
          }
        }
      }

      return {
        hasRole: false,
        reason: "no-permission",
        userId: slackUser.userId,
        orgId: regionResult.orgId,
      };
    }),

  /**
   * Get all F3 roles for a Slack user on the region org.
   * Returns role names the user has on the region and any ancestor orgs.
   */
  getUserRoles: apiKeyProcedure
    .input(
      z.object({
        slackId: z.string(),
        teamId: z.string(),
      }),
    )
    .route({
      method: "GET",
      path: "/user-roles",
      tags: ["slack"],
      summary: "Get user roles on region",
      description:
        "Get all F3 roles a Slack user has on the region org and its ancestors",
    })
    .handler(async ({ context: ctx, input }) => {
      // First, find the slack user and their linked F3 user
      const [slackUser] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, input.slackId));

      if (!slackUser?.userId) {
        return {
          roles: [],
          userId: null,
          regionOrgId: null,
        };
      }

      // Find the region org associated with this Slack workspace
      const [regionResult] = await ctx.db
        .select({
          orgId: schema.orgs.id,
          orgName: schema.orgs.name,
        })
        .from(schema.slackSpaces)
        .innerJoin(
          schema.orgsXSlackSpaces,
          eq(schema.orgsXSlackSpaces.slackSpaceId, schema.slackSpaces.id),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.orgsXSlackSpaces.orgId),
        )
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      if (!regionResult) {
        return {
          roles: [],
          userId: slackUser.userId,
          regionOrgId: null,
        };
      }

      // Get org hierarchy (region + ancestors)
      const orgIds: number[] = [regionResult.orgId];
      let currentParentId = (
        await ctx.db
          .select({ parentId: schema.orgs.parentId })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, regionResult.orgId))
      )[0]?.parentId;

      while (currentParentId) {
        orgIds.push(currentParentId);
        const [parent] = await ctx.db
          .select({ parentId: schema.orgs.parentId })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, currentParentId));
        currentParentId = parent?.parentId;
      }

      // Get all roles for this user on these orgs
      const userRoles = await ctx.db
        .select({
          orgId: schema.rolesXUsersXOrg.orgId,
          orgName: schema.orgs.name,
          roleName: schema.roles.name,
        })
        .from(schema.rolesXUsersXOrg)
        .innerJoin(
          schema.roles,
          eq(schema.roles.id, schema.rolesXUsersXOrg.roleId),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId),
        )
        .where(eq(schema.rolesXUsersXOrg.userId, slackUser.userId));

      // Filter to only roles on the region or its ancestors
      const relevantRoles = userRoles.filter((r) => orgIds.includes(r.orgId));

      // Determine effective admin status:
      // User is admin if they have admin role on region or any ancestor
      const isAdmin = relevantRoles.some((r) => r.roleName === "admin");
      const isEditor = relevantRoles.some(
        (r) => r.roleName === "editor" || r.roleName === "admin",
      );

      return {
        roles: relevantRoles,
        userId: slackUser.userId,
        regionOrgId: regionResult.orgId,
        isAdmin,
        isEditor,
      };
    }),

  /**
   * Connect a Slack workspace to an F3 org (region, area, etc.)
   * Creates or finds the org and links it to the Slack space via orgsXSlackSpaces.
   */
  connectSpaceToOrg: apiKeyProcedure
    .input(
      z.object({
        teamId: z.string(),
        orgId: z.number().optional(),
        newOrgName: z.string().optional(),
        orgType: z
          .enum(["ao", "region", "area", "sector", "nation"])
          .optional()
          .default("region"),
      }),
    )
    .route({
      method: "POST",
      path: "/connect-space-to-org",
      tags: ["slack"],
      summary: "Connect Slack space to an F3 org",
      description:
        "Link a Slack workspace to an existing org or create a new one and link it",
    })
    .handler(async ({ context: ctx, input }) => {
      // Find the slack space
      const [space] = await ctx.db
        .select()
        .from(schema.slackSpaces)
        .where(eq(schema.slackSpaces.teamId, input.teamId));

      if (!space) {
        throw new Error("Slack space not found");
      }

      // Check if already connected
      const [existingLink] = await ctx.db
        .select()
        .from(schema.orgsXSlackSpaces)
        .where(eq(schema.orgsXSlackSpaces.slackSpaceId, space.id));

      if (existingLink) {
        throw new Error("Slack space is already connected to an org");
      }

      let orgId: number;

      if (input.orgId) {
        // Use existing org
        const [org] = await ctx.db
          .select()
          .from(schema.orgs)
          .where(eq(schema.orgs.id, input.orgId));

        if (!org) {
          throw new Error("Org not found");
        }
        orgId = org.id;
      } else if (input.newOrgName) {
        // Create new org
        const [newOrg] = await ctx.db
          .insert(schema.orgs)
          .values({
            name: input.newOrgName,
            orgType: input.orgType,
            isActive: true,
          })
          .returning();

        if (!newOrg) {
          throw new Error("Failed to create org");
        }
        orgId = newOrg.id;
      } else {
        throw new Error("Either orgId or newOrgName must be provided");
      }

      // Create the link
      await ctx.db.insert(schema.orgsXSlackSpaces).values({
        orgId,
        slackSpaceId: space.id,
      });

      return { success: true, orgId };
    }),

  /**
   * Assign a role to a user for a specific org.
   * Used to grant admin/editor permissions on an org.
   */
  assignUserRole: apiKeyProcedure
    .input(
      z.object({
        userId: z.number(),
        orgId: z.number(),
        roleName: z.enum(["user", "editor", "admin"]),
      }),
    )
    .route({
      method: "POST",
      path: "/assign-user-role",
      tags: ["slack"],
      summary: "Assign role to user on org",
      description: "Grant a user a specific role on an F3 org",
    })
    .handler(async ({ context: ctx, input }) => {
      // Get the role ID
      const [role] = await ctx.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, input.roleName));

      if (!role) {
        throw new Error(`Role '${input.roleName}' not found`);
      }

      // Check if user already has this role on this org
      const [existingRole] = await ctx.db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(
          and(
            eq(schema.rolesXUsersXOrg.userId, input.userId),
            eq(schema.rolesXUsersXOrg.orgId, input.orgId),
            eq(schema.rolesXUsersXOrg.roleId, role.id),
          ),
        );

      if (existingRole) {
        // Already has the role, just return success
        return { success: true, alreadyHadRole: true };
      }

      // Insert the role assignment
      await ctx.db.insert(schema.rolesXUsersXOrg).values({
        userId: input.userId,
        orgId: input.orgId,
        roleId: role.id,
      });

      return { success: true, alreadyHadRole: false };
    }),

  /**
   * Get admin users for an org that have linked Slack accounts.
   * Returns userId + slackId pairs for populating the admin multi-user select.
   */
  getOrgAdmins: apiKeyProcedure
    .input(
      z.object({
        orgId: z.coerce.number(),
        teamId: z.string(),
      }),
    )
    .route({
      method: "GET",
      path: "/org-admins",
      tags: ["slack"],
      summary: "Get org admin users with Slack IDs",
      description:
        "Get admin users for an org that have linked Slack accounts in the given team",
    })
    .handler(async ({ context: ctx, input }) => {
      // Get the admin role ID
      const [adminRole] = await ctx.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      if (!adminRole) {
        return { admins: [] };
      }

      // Join rolesXUsersXOrg -> slackUsers to get admin users with Slack IDs
      const admins = await ctx.db
        .select({
          userId: schema.rolesXUsersXOrg.userId,
          slackId: schema.slackUsers.slackId,
        })
        .from(schema.rolesXUsersXOrg)
        .innerJoin(
          schema.slackUsers,
          and(
            eq(schema.slackUsers.userId, schema.rolesXUsersXOrg.userId),
            eq(schema.slackUsers.slackTeamId, input.teamId),
          ),
        )
        .where(
          and(
            eq(schema.rolesXUsersXOrg.orgId, input.orgId),
            eq(schema.rolesXUsersXOrg.roleId, adminRole.id),
            isNotNull(schema.slackUsers.slackId),
          ),
        );

      return { admins };
    }),

  /**
   * Replace the full admin list for an org.
   * Only removes admin roles for users that have Slack accounts in the given team,
   * preserving admins added through other channels (e.g., Maps UI).
   */
  setOrgAdmins: apiKeyProcedure
    .input(
      z.object({
        orgId: z.number(),
        userIds: z.array(z.number()),
        teamId: z.string(),
      }),
    )
    .route({
      method: "POST",
      path: "/set-org-admins",
      tags: ["slack"],
      summary: "Replace org admin list",
      description:
        "Replace admin role assignments for an org, scoped to slack-linked users",
    })
    .handler(async ({ context: ctx, input }) => {
      // Get the admin role ID
      const [adminRole] = await ctx.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, "admin"));

      if (!adminRole) {
        throw new Error("Admin role not found");
      }

      // Find existing admin users that have Slack accounts in this team
      const existingSlackAdmins = await ctx.db
        .select({
          userId: schema.rolesXUsersXOrg.userId,
        })
        .from(schema.rolesXUsersXOrg)
        .innerJoin(
          schema.slackUsers,
          and(
            eq(schema.slackUsers.userId, schema.rolesXUsersXOrg.userId),
            eq(schema.slackUsers.slackTeamId, input.teamId),
          ),
        )
        .where(
          and(
            eq(schema.rolesXUsersXOrg.orgId, input.orgId),
            eq(schema.rolesXUsersXOrg.roleId, adminRole.id),
            isNotNull(schema.slackUsers.slackId),
          ),
        );

      const existingUserIds = existingSlackAdmins.map((a) => a.userId);

      // Delete existing slack-linked admin assignments
      if (existingUserIds.length > 0) {
        await ctx.db
          .delete(schema.rolesXUsersXOrg)
          .where(
            and(
              eq(schema.rolesXUsersXOrg.orgId, input.orgId),
              eq(schema.rolesXUsersXOrg.roleId, adminRole.id),
              inArray(schema.rolesXUsersXOrg.userId, existingUserIds),
            ),
          );
      }

      // Insert new admin assignments
      if (input.userIds.length > 0) {
        const values = input.userIds
          .filter((uid) => uid != null)
          .map((userId) => ({
            userId,
            orgId: input.orgId,
            roleId: adminRole.id,
          }));

        if (values.length > 0) {
          await ctx.db
            .insert(schema.rolesXUsersXOrg)
            .values(values)
            .onConflictDoNothing();
        }
      }

      return { success: true };
    }),

  /**
   * Typeahead search for users by f3Name, firstName, or lastName.
   * Used for Slack external_select elements.
   */
  searchUsers: apiKeyProcedure
    .input(
      z.object({
        searchTerm: z.string().min(1).describe("Search query for user name"),
        limit: z
          .number()
          .min(1)
          .max(30)
          .default(30)
          .optional()
          .describe("Maximum number of results to return"),
      }),
    )
    .route({
      method: "GET",
      path: "/search/users",
      tags: ["slack"],
      summary: "Search users for typeahead",
      description:
        "Search for F3 users by f3Name, firstName, or lastName. Returns up to 30 results for use in Slack external select elements.",
    })
    .handler(async ({ context: ctx, input }) => {
      const searchPattern = `%${input.searchTerm}%`;
      const limit = input.limit ?? 30;

      // Alias for the home region org join
      const homeRegion = schema.orgs;

      const users = await ctx.db
        .select({
          id: schema.users.id,
          f3Name: schema.users.f3Name,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          homeRegionName: homeRegion.name,
        })
        .from(schema.users)
        .leftJoin(homeRegion, eq(schema.users.homeRegionId, homeRegion.id))
        .where(
          and(
            eq(schema.users.status, "active"),
            or(
              ilike(schema.users.f3Name, searchPattern),
              ilike(schema.users.firstName, searchPattern),
              ilike(schema.users.lastName, searchPattern),
            ),
          ),
        )
        .limit(limit);

      return users;
    }),

  /**
   * Typeahead search for regions by name.
   * Used for Slack external_select elements.
   */
  searchRegions: apiKeyProcedure
    .input(
      z.object({
        searchTerm: z.string().min(1).describe("Search query for region name"),
        limit: z
          .number()
          .min(1)
          .max(30)
          .default(30)
          .optional()
          .describe("Maximum number of results to return"),
      }),
    )
    .route({
      method: "GET",
      path: "/search/regions",
      tags: ["slack"],
      summary: "Search regions for typeahead",
      description:
        "Search for F3 regions by name. Returns up to 30 active regions for use in Slack external select elements.",
    })
    .handler(async ({ context: ctx, input }) => {
      const searchPattern = `%${input.searchTerm}%`;
      const limit = input.limit ?? 30;

      const regions = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
        })
        .from(schema.orgs)
        .where(
          and(
            eq(schema.orgs.orgType, "region"),
            eq(schema.orgs.isActive, true),
            ilike(schema.orgs.name, searchPattern),
          ),
        )
        .limit(limit);

      return regions;
    }),
};
