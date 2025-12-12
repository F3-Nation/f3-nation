import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { sendVerifyEmail } from "@acme/auth/lib/utils";
import { eq, schema } from "@acme/db";
import { ErrorMessage } from "@acme/shared/common/enums";
import { normalizeEmail } from "@acme/shared/common/functions";

import { protectedProcedure, publicProcedure } from "../shared";

export const authRouter = {
  getSession: publicProcedure.handler(({ context: ctx }) => {
    return ctx.session;
  }),
  getSecretMessage: protectedProcedure.handler(() => {
    // testing type validation of overridden next-auth Session in @acme/auth package
    return "you can see this secret message!";
  }),
  sendVerify: publicProcedure
    .input(
      z.object({
        email: z.string(),
        callbackUrl: z.string(),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const normalizedEmail = normalizeEmail(input.email);
      // make sure user doesnt exist already
      const existing = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail));

      if (!existing) {
        throw new ORPCError("BAD_REQUEST", {
          message: ErrorMessage.NO_USER_FOUND,
        });
      }

      // Send a verification email
      await sendVerifyEmail({
        db: ctx.db,
        email: normalizedEmail,
        callbackUrl: input.callbackUrl,
      });

      return { success: true, error: null };
    }),
};
