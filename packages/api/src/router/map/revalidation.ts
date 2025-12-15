import { revalidatePath } from "next/cache";
import { z } from "zod";

import { notifyWebhooks } from "../../lib/notify-webhooks";
import { apiKeyProcedure } from "../../shared";

export const apiRouter = {
  revalidate: apiKeyProcedure
    .input(
      z
        .object({
          eventId: z.number().optional(),
          locationId: z.number().optional(),
          orgId: z.number().optional(),
          action: z.enum(["map.updated", "map.created", "map.deleted"]),
        })
        .optional(),
    )
    .route({
      method: "POST",
      path: "/revalidate",
      tags: ["api"],
      summary: "Revalidate cache",
      description:
        "Trigger cache revalidation and notify webhooks about map changes",
    })
    .handler(async ({ input }) => {
      revalidatePath("/");
      if (input) {
        await notifyWebhooks(input);
      }
      return { success: true };
    }),
};
