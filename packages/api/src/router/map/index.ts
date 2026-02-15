import { ORPCError } from "@orpc/server";
import { os } from "@orpc/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { eq, schema } from "@acme/db";
import { env } from "@acme/env";
import { MailService, Templates } from "@acme/mail";
import { adminProcedure, protectedProcedure } from "../../shared";
import { checkHasRoleOnOrg } from "../../check-has-role-on-org";
import { mapEventRouter } from "./event";
import { mapLocationRouter } from "./location";

export const feedbackSchema = z.object({
  type: z.string(),
  subject: z.string(),
  email: z.string(),
  description: z.string(),
});

export const mapRouter = os.router({
  event: os.prefix("/event").router(mapEventRouter),
  location: os.prefix("/location").router(mapLocationRouter),

  revalidate: adminProcedure
    .route({
      method: "POST",
      path: "/revalidate",
      tags: ["revalidate"],
      summary: "Revalidate cache",
      description: "Trigger cache revalidation for the map data",
    })
    .handler(async ({ context: ctx }) => {
      const [nation] = await ctx.db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "nation"));
      if (!nation) {
        throw new ORPCError("NOT_FOUND", {
          message: "Nation not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: nation.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to revalidate this Nation",
        });
      }

      // Revalidate API app cache
      revalidatePath("/");

      // Also trigger Map app revalidation via HTTP request
      // This is necessary because the API and Map apps are separate Next.js instances
      const mapUrl = env.NEXT_PUBLIC_MAP_URL?.endsWith("/")
        ? env.NEXT_PUBLIC_MAP_URL.slice(0, -1)
        : env.NEXT_PUBLIC_MAP_URL;

      if (!mapUrl || !env.SUPER_ADMIN_API_KEY) {
        console.error("Failed to revalidate Map app cache", {
          mapUrl,
          superAdminKeyExists: !!env.SUPER_ADMIN_API_KEY,
        });
        return;
      }

      try {
        const response = await fetch(`${mapUrl}/api/revalidate`, {
          method: "POST",
          headers: {
            "x-api-key": env.SUPER_ADMIN_API_KEY,
          },
        });

        if (!response.ok) {
          console.error("Failed to revalidate Map app cache", {
            status: response.status,
            statusText: response.statusText,
          });
          // Don't throw - API revalidation succeeded, Map revalidation is best-effort
        } else {
          console.log("Map app cache revalidated successfully");
        }
      } catch (error) {
        console.error("Error calling Map app revalidation endpoint", {
          error,
        });
        // Don't throw - API revalidation succeeded, Map revalidation is best-effort
      }
    }),

  submitFeedback: protectedProcedure
    .input(feedbackSchema)
    .route({
      method: "POST",
      path: "/submit-feedback",
      tags: ["feedback"],
      summary: "Submit feedback",
      description: "Submit user feedback via email to the F3 Nation team",
    })
    .handler(async ({ input }) => {
      // testing type validation of overridden next-auth Session in @acme/auth package

      const mailService = new MailService();
      await mailService.sendTemplateMessages(Templates.feedbackForm, input);

      return { success: true };
    }),
});
