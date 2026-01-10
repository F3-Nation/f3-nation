import { z } from "zod";

import { eq, schema } from "@acme/db";
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
      // Find the slack user first
      const [slackUser] = await ctx.db
        .select()
        .from(schema.slackUsers)
        .where(eq(schema.slackUsers.slackId, input.slackId));

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

  getRegion: publicProcedure
    .input(z.object({ teamId: z.string() }))
    .route({
      method: "GET",
      path: "/region",
      tags: ["slack"],
      summary: "Get region for Slack space",
      description: "Retrieve the region associated with a Slack workspace",
    })
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select({
          org: schema.orgs,
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

      return result;
    }),
};
