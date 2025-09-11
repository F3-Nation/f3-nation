import { z } from "zod";

import { ShadCNFormFactory } from "@acme/ui/form";
import { RequestInsertSchema } from "@acme/validators";

export const {
  useSchemaForm: useUpdateLocationForm,
  useSchemaFormContext: useUpdateLocationFormContext,
} = ShadCNFormFactory(
  RequestInsertSchema.extend({
    badImage: z.boolean().default(false),
    eventStartTime: z.string().regex(/^\d{2}:\d{2}$/, {
      message: "Start time must be in 24hr format (HH:mm)",
    }),
    eventEndTime: z.string().regex(/^\d{2}:\d{2}$/, {
      message: "End time must be in 24hr format (HH:mm)",
    }),
  }),
);
