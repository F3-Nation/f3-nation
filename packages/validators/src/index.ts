import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import {
  events,
  eventTypes,
  locations,
  orgs,
  updateRequests,
  users,
} from "@acme/db/schema/schema";
import { DayOfWeek } from "@acme/shared/app/enums";

// USER SCHEMA
export const UserSelectSchema = createSelectSchema(users);
export const UserInsertSchema = createInsertSchema(users);

export const CrupdateUserSchema = UserInsertSchema.extend({
  id: z.number().optional(),

  roles: z
    .object({
      orgId: z.number(),
      roleName: z.enum(["user", "editor", "admin"]),
    })
    .array(),
  f3Name: z.string().min(1, { message: "F3 Name is required" }),
  email: z
    .string()
    .email({ message: "Invalid email format" })
    .or(z.literal(""))
    .optional(),
});

// AUTH SCHEMA
export const EmailAuthSchema = UserInsertSchema.pick({
  email: true,
}).extend({
  email: z.string().email(),
});

// LOCATION SCHEMA
export const LocationInsertSchema = createInsertSchema(locations);
export const LocationSelectSchema = createSelectSchema(locations);

// EVENT TYPE SCHEMA
export const EventTypeInsertSchema = createInsertSchema(eventTypes);
export const EventTypeSelectSchema = createSelectSchema(eventTypes);

// EVENT SCHEMA
export const EventInsertSchema = createInsertSchema(events, {
  name: (s) => s.min(1, { message: "Name is required" }),
  locationId: (s) =>
    s
      .min(1, { message: "Please select an location" })
      .refine((value) => value !== -1, { message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
  startTime: (s) =>
    s.regex(/^\d{4}$/, {
      message: "Start time must be in 24hr format (HHmm)",
    }),
  endTime: (s) =>
    s.regex(/^\d{4}$/, {
      message: "End time must be in 24hr format (HHmm)",
    }),
})
  .extend({
    regionId: z.number(),
    aoId: z.number(),
    eventTypeIds: z
      .number()
      .array()
      .min(1, { message: "Event type is required" }),
  })
  .omit({
    orgId: true,
  });
export const EventSelectSchema = createSelectSchema(events);

export const CreateEventSchema = EventInsertSchema.omit({
  id: true,
  created: true,
  updated: true,
});
export type EventInsertType = z.infer<typeof CreateEventSchema>;

// NATION SCHEMA
export const NationInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
  parentId: z.null({ message: "Must not have a parent" }).optional(),
}).omit({ orgType: true });
export const NationSelectSchema = createSelectSchema(orgs);

// SECTOR SCHEMA
export const SectorInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  parentId: z
    .number({ message: "Must have a parent" })
    .nonnegative({ message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
}).omit({ orgType: true });
export const SectorSelectSchema = createSelectSchema(orgs);

// AREA SCHEMA
export const AreaInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  parentId: z
    .number({ message: "Must have a parent" })
    .nonnegative({ message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
}).omit({ orgType: true });
export const AreaSelectSchema = createSelectSchema(orgs);

// REGION SCHEMA
export const RegionInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  parentId: z
    .number({ message: "Must have a parent" })
    .nonnegative({ message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
}).omit({ orgType: true });
export const RegionSelectSchema = createSelectSchema(orgs);

// AO SCHEMA
export const AOInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  parentId: z
    .number({ message: "Must have a parent" })
    .nonnegative({ message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
}).omit({ orgType: true });
export const AOSelectSchema = createSelectSchema(orgs);

// ORG SCHEMA
export const OrgInsertSchema = createInsertSchema(orgs, {
  name: (s) => s.min(1, { message: "Name is required" }),
  parentId: z
    .number({ message: "Must have a parent" })
    .nonnegative({ message: "Invalid selection" }),
  email: (s) => s.email({ message: "Invalid email format" }).or(z.literal("")),
});
export const OrgSelectSchema = createSelectSchema(orgs);

export const DeleteRequestSchema = z.object({
  eventId: z.number(),
  eventName: z.string(),
  regionId: z.number(),
  submittedBy: z.string(),
});

// REQUEST UPDATE SCHEMA
export const RequestInsertSchema = createInsertSchema(updateRequests, {
  eventTypeIds: (s) =>
    s.min(1, { message: "Please select at least one event type" }),
  eventName: (s) => s.min(1, { message: "Workout name is required" }),
  // We don't want to require an event description
  // eventDescription: (s) => s.min(1, { message: "Description is required" }),
  eventDayOfWeek: z.enum(DayOfWeek, {
    message: "Day of the week is required",
  }),
  aoName: (s) => s.min(1, { message: "AO name is required" }),
  // Location fields are optional
  // locationAddress: (s) => s.min(1, { message: "Location address is required" }),
  // locationCity: (s) => s.min(1, { message: "Location city is required" }),
  // locationState: (s) => s.min(1, { message: "Location state is required" }),
  // locationZip: (s) => s.min(1, { message: "Location zip is required" }),
  // locationCountry: (s) => s.min(1, { message: "Location country is required" }),
  regionId: z.number({ invalid_type_error: "Region is required" }),
  eventStartTime: (s) =>
    s.regex(/^\d{4}$/, {
      message: "Start time must be in 24hr format (HHmm)",
    }),
  eventEndTime: (s) =>
    s.regex(/^\d{4}$/, {
      message: "End time must be in 24hr format (HHmm)",
    }),
  submittedBy: (s) => s.email({ message: "Invalid email address" }),
}).extend({
  id: z.string(),
  eventMeta: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateRequestSelectSchema = createSelectSchema(updateRequests);

export const AllLocationMarkerFilterDataSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    logo: z.string().nullish(),
    events: z
      .object({
        id: z.number(),
        dayOfWeek: z.enum(DayOfWeek).nullable(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
        types: z.array(z.object({ id: z.number(), name: z.string() })),
        name: z.string(),
      })
      .array(),
  })
  .array();

export const LowBandwidthF3Marker = z.tuple([
  z.number(), // location id
  z.string(), // location name
  z.string().nullable(), // location logo
  z.number(), // location lat
  z.number(), // location lon
  z.string().nullable(), // location full address
  z
    .tuple([
      z.number(), // event id
      z.string(), // event name
      z.enum(DayOfWeek).nullable(), // event day of week
      z.string().nullable(), // event start time
      z.array(z.object({ id: z.number(), name: z.string() })), // event types
    ])
    .array(),
]);

export type LowBandwidthF3Marker = z.infer<typeof LowBandwidthF3Marker>;

export const SortingSchema = z
  .object({
    id: z.string(),
    desc: z.coerce.boolean(),
  })
  .array();

export type SortingSchema = z.infer<typeof SortingSchema>;

export const UpdateRequestResponseSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  updateRequest: createInsertSchema(updateRequests),
});

export type UpdateRequestResponse = z.infer<typeof UpdateRequestResponseSchema>;

export const DeleteRequestResponseSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  deleteRequest: createInsertSchema(updateRequests).deepPartial(),
});

export type DeleteRequestResponse = z.infer<typeof DeleteRequestResponseSchema>;
