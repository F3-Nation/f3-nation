import { z } from "zod";

import { ShadCNFormFactory } from "@acme/ui/form";
import { RequestInsertSchema } from "@acme/validators";

const timeFormat = z
  .string()
  .regex(/^\d{2}:\d{2}$/, {
    message: "Start time must be in 24hr format (HH:mm)",
  })
  .or(z.literal(""));

export const {
  useSchemaForm: useUpdateLocationForm,
  useSchemaFormContext: useUpdateLocationFormContext,
} = ShadCNFormFactory(
  RequestInsertSchema.extend({
    badImage: z.boolean().default(false),
    eventStartTime: timeFormat,
    eventEndTime: timeFormat,
    eventName: z.string().optional().or(z.literal("")),
    eventTypeIds: z.array(z.number()).optional(),
  }),
);
