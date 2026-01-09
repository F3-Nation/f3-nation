import { z } from "zod";

import { and, eq, schema } from "@acme/db";
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
      return space;
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
        ...(space.settings as any),
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
