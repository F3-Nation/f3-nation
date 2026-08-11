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

// HHmm strings ("0530", "1815") compare correctly lexicographically, so a
// plain string comparison is enough here without parsing to minutes. Chained
// onto each concrete schema below (rather than onto EventFields itself)
// because `.extend(EventFields.shape)` copies only the raw field defs and
// drops any refinement attached to EventFields.
const checkEventTimeOrder = (
  data: { eventStartTime?: unknown; eventEndTime?: unknown },
  ctx: z.RefinementCtx,
) => {
  const { eventStartTime, eventEndTime } = data;
  if (
    typeof eventStartTime === "string" &&
    typeof eventEndTime === "string" &&
    eventStartTime !== "" &&
    eventEndTime !== "" &&
    eventStartTime >= eventEndTime
  ) {
    ctx.addIssue({
      code: "custom",
      message: "End time must be after start time",
      path: ["eventEndTime"],
    });
  }
};

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

// Location-related fields. Only lat/lng are required — many workouts have no
// street address, so every address field must accept missing/blank values.
const optionalAddressField = (schema: z.ZodString) =>
  z.preprocess(
    (val) => (val === "" ? undefined : val),
    schema.optional().nullable(),
  );

export const LocationFields = z.object({
  locationLat: z.number(),
  locationLng: z.number(),
  locationAddress: optionalAddressField(
    z.string().min(5, "Address must be at least 5 characters"),
  ),
  locationAddress2: z.string().optional().nullable(),
  locationCity: optionalAddressField(
    z.string().min(2, "City must be at least 2 characters"),
  ),
  locationState: optionalAddressField(
    z.string().min(2, "State must be at least 2 characters"),
  ),
  locationZip: optionalAddressField(
    z.string().min(3, "ZIP code must be at least 3 characters"),
  ),
  locationCountry: optionalAddressField(
    z.string().min(2, "Country must be at least 2 characters"),
  ),
  locationDescription: z.string().optional().nullable(),
});

export type LocationFieldsType = z.infer<typeof LocationFields>;

// Region-related fields
export const RegionFields = z.object({
  originalRegionId: z.number().positive("Original region ID is required"),
});

export type RegionFieldsType = z.infer<typeof RegionFields>;

// Base schema with common fields.
export const BaseSchema = RequestInsertSchema.pick({
  requestType: true,
  submittedBy: true,
  eventMeta: true,
}).extend({
  id: z.uuid(),
  eventMeta: z.record(z.string(), z.unknown()).optional(),
  originalEventId: z.number().nullish(),
  originalLocationId: z.number().nullish(),
  originalAoId: z.number().nullish(),
  originalRegionId: z.number().positive("Original region ID is required"),
});
export type BaseSchemaType = z.infer<typeof BaseSchema>;

// The org-id fields that drive editor-permission checks (checkRequest /
// checkUpdatePermissions in packages/api). Shared so a refactor of one
// consumer can't silently narrow away a field the other still reads —
// fewer checked orgs means checkUpdatePermissions fails open, not closed.
export type UpdateRequestOrgIdFields = Partial<
  Pick<
    BaseSchemaType,
    | "originalEventId"
    | "originalAoId"
    | "originalLocationId"
    | "originalRegionId"
  >
> & {
  newAoId?: number | null;
  newLocationId?: number | null;
  newRegionId?: number | null;
};

// CREATE LOCATION AND EVENT (create_ao_and_location_and_event)

export const CreateAOAndLocationAndEventSchema = BaseSchema.extend({
  requestType: z.literal("create_ao_and_location_and_event"),
})
  .extend(EventFields.shape)
  .extend(AOFields.shape)
  .extend(LocationFields.shape)
  .extend(RegionFields.shape)
  .superRefine(checkEventTimeOrder);

export type CreateAOAndLocationAndEventType = z.infer<
  typeof CreateAOAndLocationAndEventSchema
>;

// CREATE EVENT (create_event)
export const CreateEventSchema = BaseSchema.extend({
  requestType: z.literal("create_event"),
  originalAoId: z.number().positive("AO ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
  originalRegionId: z.number().positive("Region ID is required"),
})
  .extend(EventFields.shape)
  .superRefine(checkEventTimeOrder);

export type CreateEventType = z.infer<typeof CreateEventSchema>;

// EDIT EVENT (edit-event)
export const EditEventSchema = BaseSchema.extend({
  requestType: z.literal("edit_event"),
  originalEventId: z.number().positive("Event ID is required"),
})
  .extend(EventFields.partial().shape)
  .extend(AOFields.partial().shape)
  .extend(LocationFields.partial().shape)
  // Optional: `currentValues` carries the entity's prior values for the review
  // UI only (stripped before persistence). Optional so the admin normalizer no
  // longer has to fabricate an empty object just to satisfy the union. (#13)
  .extend({ currentValues: makeSchemaLoose(EventFields).optional() })
  .superRefine(checkEventTimeOrder);

export type EditEventType = z.infer<typeof EditEventSchema>;

// EDIT AO AND LOCATION (edit-ao-and-location)
export const EditAOAndLocationSchema = BaseSchema.extend({
  requestType: z.literal("edit_ao_and_location"),
  originalAoId: z.number().positive("AO ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .extend(AOFields.partial().shape)
  .extend(LocationFields.partial().shape)
  .extend({
    currentValues: makeSchemaLoose(
      AOFields.extend(LocationFields.shape),
    ).optional(),
  });

export type EditAOAndLocationType = z.infer<typeof EditAOAndLocationSchema>;

// EDIT AO (edit_ao) — AO fields only; the location is edited separately.
export const EditAOSchema = BaseSchema.extend({
  requestType: z.literal("edit_ao"),
  originalAoId: z.number().positive("AO ID is required"),
})
  .extend(AOFields.partial().shape)
  .extend({ currentValues: makeSchemaLoose(AOFields).optional() });

export type EditAOType = z.infer<typeof EditAOSchema>;

// EDIT LOCATION (edit_location) — location fields only. The location row may
// be shared by multiple AOs (several events.orgId at one events.locationId);
// the client warns before submitting, but the write itself is a plain
// single-row location update.
export const EditLocationSchema = BaseSchema.extend({
  requestType: z.literal("edit_location"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .extend(LocationFields.partial().shape)
  .extend({
    // Set true once the submitter has acknowledged that this location is shared
    // by multiple AOs. Enforced server-side (handleEditLocation) so the
    // client-only disabled button can't be bypassed.
    acknowledgeShared: z.boolean().optional(),
    currentValues: makeSchemaLoose(LocationFields).optional(),
  });

export type EditLocationType = z.infer<typeof EditLocationSchema>;

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
  .extend(LocationFields.shape)
  .extend({
    currentValues: makeSchemaLoose(LocationFields).optional(),
  });

export type MoveAOToNewLocationType = z.infer<typeof MoveAOToNewLocationSchema>;

// MOVE AO TO DIFFERENT LOCATION (move_ao_to_different_location)
export const MoveAOToDifferentLocationSchema = BaseSchema.extend({
  requestType: z.literal("move_ao_to_different_location"),
  originalAoId: z.number().positive("Original AO ID is required"),
  originalLocationId: z.number().positive("Original location ID is required"),
  newLocationId: z
    .number()
    .positive("Target location ID is required")
    .nullable(),
}).extend(LocationFields.partial().shape);

export type MoveAOToDifferentLocationType = z.infer<
  typeof MoveAOToDifferentLocationSchema
>;

// MOVE EVENT TO DIFFERENT AO (move_event_to_different_ao)
export const MoveEventToDifferentAOSchema = BaseSchema.extend({
  requestType: z.literal("move_event_to_different_ao"),
  originalEventId: z.number().positive("Event ID is required"),
  originalAoId: z.number().positive("Original AO ID is required"),
  newRegionId: z.number().positive("Target region ID is required").optional(),
  newAoId: z.number().positive("Target AO ID is required"),
  newLocationId: z
    .number()
    .positive("Target location ID is required")
    .optional(),
}).extend(LocationFields.partial().shape);

export type MoveEventToDifferentAOType = z.infer<
  typeof MoveEventToDifferentAOSchema
>;

// MOVE EVENT TO NEW AO (move_event_to_new_ao)
export const MoveEventToNewAOSchema = BaseSchema.extend({
  requestType: z.literal("move_event_to_new_ao"),
  originalEventId: z.number().positive("Event ID is required"),
  originalAoId: z.number().positive("Original AO ID is required"),
  originalLocationId: z.number().positive("Original location ID is required"),
  newLocationId: z
    .number()
    .positive("Target location ID is required")
    .nullable(),
  newRegionId: z.number().positive("Target region ID is required").optional(),
})
  .extend(AOFields.shape)
  .extend(LocationFields.shape);

export type MoveEventToNewAOType = z.infer<typeof MoveEventToNewAOSchema>;

// MOVE EVENT TO NEW LOCATION (move_event_to_new_location)
export const MoveEventToNewLocationSchema = BaseSchema.extend({
  requestType: z.literal("move_event_to_new_location"),
  originalEventId: z.number().positive("Event ID is required"),
  originalLocationId: z.number().positive("Location ID is required"),
})
  .extend(LocationFields.shape)
  .extend({ currentValues: makeSchemaLoose(LocationFields).optional() });

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
  const looseShape: Record<string, z.ZodOptional<z.ZodUnknown>> = {};

  for (const key in shape) {
    // Optional so missing keys pass — a bare `z.unknown()` is required in Zod 4.
    looseShape[key] = z.unknown().optional();
  }

  return z.object(looseShape);
}
