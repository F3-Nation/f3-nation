import { z } from "zod";

import { eq, schema } from "@acme/db";

import { publicProcedure } from "../shared";

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
};
