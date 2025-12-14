import { z } from "zod";

import { DayOfWeek } from "@acme/shared/app/enums";

import { RequestInsertSchema } from ".";

// Event-related fields
export const EventFields = z.object({
  eventName: z.string().min(3, "Event name must be at least 3 characters"),
  eventDayOfWeek: z.enum(DayOfWeek),
  eventStartTime: z.string().regex(/^\d{4}$/, {
    message: "Start time must be in 24hr format (HHmm)",
  }),
  eventEndTime: z.string().regex(/^\d{4}$/, {
    message: "End time must be in 24hr format (HHmm)",
  }),
  eventStartDate: z.string().nullish(),
  eventDescription: z.string().optional(),
  eventTypeIds: z
    .array(z.number())
    .min(1, "At least one event type is required"),
});

export type EventFieldsType = z.infer<typeof EventFields>;

// AO-related fields
export const AOFields = z.object({
  aoName: z.string().min(2, "AO name must be at least 2 characters"),
  aoLogo: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().url("Must be a valid URL").optional().nullable(),
  ),
  aoWebsite: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().url("Must be a valid URL").optional().nullable(),
  ),
});

export type AOFieldsType = z.infer<typeof AOFields>;

// Location-related fields
export const LocationFields = z.object({
  locationLat: z.number(),
  locationLng: z.number(),
  locationAddress: z.string().min(5, "Address must be at least 5 characters"),
  locationAddress2: z.string().optional().nullable(),
  locationCity: z.string().min(2, "City must be at least 2 characters"),
  locationState: z.string().min(2, "State must be at least 2 characters"),
  locationZip: z.string().min(3, "ZIP code must be at least 3 characters"),
  locationCountry: z
    .string()
    .min(2, "Country must be at least 2 characters")
    .default("United States"),
  locationDescription: z.string().optional().nullable(),
});

export type LocationFieldsType = z.infer<typeof LocationFields>;

// Region-related fields
export const RegionFields = z.object({
  originalRegionId: z.number(),
});

export type RegionFieldsType = z.infer<typeof RegionFields>;

// Base schema with common fields
export const BaseSchema = RequestInsertSchema.pick({
  requestType: true,
  submittedBy: true,
  reviewedBy: true,
  eventMeta: true,
}).extend({
  id: z.string(),
  isReview: z.boolean().default(false),
  eventMeta: z.record(z.string(), z.unknown()).optional(),
  originalEventId: z.number().nullish(),
  originalLocationId: z.number().nullish(),
  originalAoId: z.number().nullish(),
  originalRegionId: z.number().positive("Original region ID is required"), // must be nullable for new events and locs?
});
export type BaseSchemaType = z.infer<typeof BaseSchema>;

// CREATE LOCATION AND EVENT (create_ao_and_location_and_event)

export const CreateAOAndLocationAndEventSchema = BaseSchema.extend({
  requestType: z.literal("create_ao_and_location_and_event"),
  badImage: z.boolean().default(false),
})
  .merge(EventFields)
  .merge(AOFields)
  .merge(LocationFields)
  .merge(RegionFields);

export type CreateAOAndLocationAndEventType = z.infer<
  typeof CreateAOAndLocationAndEventSchema
>;

// CREATE EVENT (create_event)
export const CreateEventSchema = BaseSchema.extend({
  requestType: z.literal("create_event"),
  originalAoId: z.number().positive("AO ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
  originalRegionId: z.number().positive("Region ID is required"),
}).merge(EventFields);

export type CreateEventType = z.infer<typeof CreateEventSchema>;

// EDIT EVENT (edit-event)
export const EditEventSchema = BaseSchema.extend({
  requestType: z.literal("edit_event"),
  originalEventId: z.number().positive("Event ID is required"),
})
  .merge(EventFields.partial())
  .extend({ currentValues: makeSchemaLoose(EventFields) });

export type EditEventType = z.infer<typeof EditEventSchema>;

// EDIT AO AND LOCATION (edit-ao-and-location)
export const EditAOAndLocationSchema = BaseSchema.extend({
  requestType: z.literal("edit_ao_and_location"),
  badImage: z.boolean().default(false),
  originalAoId: z.number().positive("AO ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .merge(AOFields.partial())
  .merge(LocationFields.partial())
  .extend({
    currentValues: makeSchemaLoose(AOFields.merge(LocationFields)),
  });

export type EditAOAndLocationType = z.infer<typeof EditAOAndLocationSchema>;

// MOVE AO TO DIFFERENT REGION (move_ao_to_different_region)
export const MoveAOToDifferentRegionSchema = BaseSchema.extend({
  requestType: z.literal("move_ao_to_different_region"),
  newRegionId: z.number().positive("Target region ID is required"),
  originalAoId: z.number().positive("Original AO ID is required"),
});

export type MoveAoToDifferentRegionType = z.infer<
  typeof MoveAOToDifferentRegionSchema
>;

// MOVE AO TO NEW LOCATION (move_ao_to_new_location)
export const MoveAOToNewLocationSchema = BaseSchema.extend({
  requestType: z.literal("move_ao_to_new_location"),
  originalAoId: z.number().positive("AO ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .merge(LocationFields)
  .extend({
    currentValues: makeSchemaLoose(LocationFields),
  });

export type MoveAOToNewLocationType = z.infer<typeof MoveAOToNewLocationSchema>;

// MOVE AO TO DIFFERENT LOCATION (move_ao_to_different_location)
export const MoveAOToDifferentLocationSchema = BaseSchema.extend({
  requestType: z.literal("move_ao_to_different_location"),
  originalAoId: z.number().positive("Original AO ID is required"),
  originalLocationId: z.number().positive("Original location ID is required"),
  newLocationId: z.number().positive("Target location ID is required"),
});

export type MoveAOToDifferentLocationType = z.infer<
  typeof MoveAOToDifferentLocationSchema
>;

// MOVE EVENT TO DIFFERENT AO (move_event_to_different_ao)
export const MoveEventToDifferentAOSchema = BaseSchema.extend({
  requestType: z.literal("move_event_to_different_ao"),
  originalEventId: z.number().positive("Event ID is required"),
  originalAoId: z.number().positive("Original AO ID is required"),
  newRegionId: z.number().positive("Target region ID is required").optional(),
  newAoId: z.number().positive("Target AO ID is required").optional(),
  newLocationId: z
    .number()
    .positive("Target location ID is required")
    .optional(),
});

export type MoveEventToDifferentAOType = z.infer<
  typeof MoveEventToDifferentAOSchema
>;

// MOVE EVENT TO NEW LOCATION (move_event_to_new_location)
export const MoveEventToNewLocationSchema = BaseSchema.extend({
  requestType: z.literal("move_event_to_new_location"),
  originalEventId: z.number().positive("Event ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .merge(LocationFields)
  .extend({ currentValues: makeSchemaLoose(LocationFields) });

export type MoveEventToNewLocationType = z.infer<
  typeof MoveEventToNewLocationSchema
>;

// DELETE EVENT (delete_event)
export const DeleteEventSchema = BaseSchema.extend({
  requestType: z.literal("delete_event"),
  originalEventId: z.number().positive("Event ID is required"),
});

export type DeleteEventType = z.infer<typeof DeleteEventSchema>;

// DELETE AO (delete_ao)
export const DeleteAOSchema = BaseSchema.extend({
  requestType: z.literal("delete_ao"),
  originalAoId: z.number().positive("AO ID is required"),
});

export type DeleteAOType = z.infer<typeof DeleteAOSchema>;

/**
 * Creates a "loose" version of a Zod schema where all fields accept any value
 * Preserves the keys for type safety but disables validation
 *
 * @example
 * const StrictSchema = z.object({ name: z.string(), age: z.number() });
 * const LooseSchema = makeSchemaLoose(StrictSchema);
 * // Result: z.object({ name: z.unknown(), age: z.unknown() })
 */
function makeSchemaLoose<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  const shape = schema.shape;
  const looseShape: Record<string, z.ZodUnknown> = {};

  for (const key in shape) {
    looseShape[key] = z.unknown(); // Accept any value for this key
  }

  return z.object(looseShape);
}
