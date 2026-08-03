import { z } from "zod";

import { ShadCNFormFactory } from "@acme/ui/form";
import { RequestInsertSchema } from "@acme/validators";

const timeFormat = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "Time must be in 24hr format (HH:mm)",
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
    aoName: z.string().optional().or(z.literal("")),
    eventTypeIds: z.array(z.number()).optional(),
    // edit_location only: the reviewer's explicit acknowledgment that this
    // location is shared by multiple AOs (see EditLocationRequestForm). Set
    // via form.setValue, not a visible field on any other request type.
    acknowledgeShared: z.boolean().optional(),
  }).superRefine((data, ctx) => {
    // "HH:mm" strings compare correctly lexicographically, so a plain string
    // comparison is enough here without parsing to minutes.
    if (
      data.eventStartTime &&
      data.eventEndTime &&
      data.eventStartTime >= data.eventEndTime
    ) {
      ctx.addIssue({
        code: "custom",
        message: "End time must be after start time",
        path: ["eventEndTime"],
      });
    }
  }),
);
