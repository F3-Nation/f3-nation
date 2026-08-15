import { os } from "@orpc/server";
import { z } from "zod";

import { MailService, Templates } from "@acme/mail";
import { triggerMapAppRevalidation } from "../../lib/revalidate-map";
import { protectedProcedure, revalidateAuthProcedure } from "../../shared";
import { mapEventRouter } from "./event";
import { mapLocationRouter } from "./location";

const feedbackSchema = z.object({
  type: z.string(),
  subject: z.string(),
  email: z.string(),
  description: z.string(),
});

export const mapRouter = os.router({
  event: os.prefix("/event").router(mapEventRouter),
  location: os.prefix("/location").router(mapLocationRouter),

  revalidate: revalidateAuthProcedure
    .route({
      method: "POST",
      path: "/revalidate",
      tags: ["revalidate"],
      summary: "Revalidate cache",
      description:
        "Trigger cache revalidation. Auth: nation admin session OR x-api-key header with SUPER_ADMIN_API_KEY",
    })
    .handler(async () => {
      // Trigger Map app revalidation via HTTP - API and Map are separate Next.js instances
      await triggerMapAppRevalidation();

      return { success: true };
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
    .output(
      z.object({
        success: z
          .boolean()
          .describe("Whether the feedback was submitted successfully"),
      }),
    )
    .handler(async ({ input }) => {
      // testing type validation of overridden next-auth Session in @acme/auth package

      const mailService = new MailService();
      await mailService.sendTemplateMessages(Templates.feedbackForm, input);

      return { success: true };
    }),
});
