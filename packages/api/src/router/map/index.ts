import { os } from "@orpc/server";
import { z } from "zod";

import { MailService, Templates } from "../../mail";
import { protectedProcedure } from "../../shared";
import { mapLocationRouter } from "./location";

export const feedbackSchema = z.object({
  type: z.string(),
  subject: z.string(),
  email: z.string(),
  description: z.string(),
});

export const mapRouter = os.router({
  location: os.prefix("/location").router(mapLocationRouter),

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
