import { z } from "zod";

import { MailService, Templates } from "../mail";
import { publicProcedure } from "../shared";

export const feedbackSchema = z.object({
  type: z.string(),
  subject: z.string(),
  email: z.string(),
  description: z.string(),
});

export const feedbackRouter = {
  submitFeedback: publicProcedure
    .input(feedbackSchema)
    .handler(async ({ input }) => {
      // testing type validation of overridden next-auth Session in @acme/auth package

      const mailService = new MailService();
      await mailService.sendTemplateMessages(Templates.feedbackForm, input);

      return { success: true };
    }),
};
