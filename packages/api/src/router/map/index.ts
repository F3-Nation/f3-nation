import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";

import { MailService, Templates } from "@acme/mail";
import { triggerMapAppRevalidation } from "../../lib/revalidate-map";
import {
  getClientIP,
  publicReadProcedure,
  revalidateAuthProcedure,
} from "../../shared";
import { mapEventRouter } from "./event";
import { mapLocationRouter } from "./location";

const feedbackSchema = z.object({
  type: z.string().max(200),
  subject: z.string().max(200),
  email: z.string().max(320), // RFC 5321 max mailbox length
  description: z.string().max(5000),
});

// submitFeedback sends a real email per call and is reachable by any
// anonymous caller — the generic 500 req/min limiter in shared.ts is meant
// for ordinary reads, not for something that can be turned into an
// email-flooding tool against the F3 Nation team's inbox. A separate,
// much tighter limiter scopes that risk to this one endpoint.
const feedbackLimiter = new MemoryRatelimiter({
  maxRequests: 5,
  window: 60_000,
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
      // Trigger Map app revalidation via HTTP - API and Map are separate services
      await triggerMapAppRevalidation();

      return { success: true };
    }),

  // Anonymous-reachable by design: the map's /help bug-report form has no
  // sign-in gate, and this handler derives nothing from ctx.session — it only
  // relays the caller-supplied email to the F3 Nation team.
  submitFeedback: publicReadProcedure
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
    .use(async ({ context, next }) => {
      const key = getClientIP(context.reqHeaders ?? null);
      const result = await feedbackLimiter.limit(key);
      if (!result.success) {
        const retryAfterMs = result.reset ? result.reset - Date.now() : 60_000;
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: `Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
        });
      }
      return next({ context });
    })
    .handler(async ({ input }) => {
      // testing type validation of overridden next-auth Session in @acme/auth package

      const mailService = new MailService();
      await mailService.sendTemplateMessages(Templates.feedbackForm, input);

      return { success: true };
    }),
});
