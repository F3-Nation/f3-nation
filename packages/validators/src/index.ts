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

export type UserSelectType = z.infer<typeof UserSelectSchema>;
export type UserInsertType = z.infer<typeof UserInsertSchema>;

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
export const EventTypeInsertSchema = createInsertSchema(eventTypes, {
  id: z.coerce.number().optional(),
  specificOrgId: z.coerce.number().nullish(),
  isActive: z.coerce.boolean().optional(),
});
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
  eventId: z.number().nullish(),
  eventName: z.string().nullish(),
  aoName: z.string().nullish(),
  originalAoId: z.number().nullish(),
  originalLocationId: z.number().nullish(),
  originalRegionId: z.number(),
  submittedBy: z.string(),
  requestType: z.enum(["delete_event", "delete_ao"]),
});

export type DeleteRequestType = z.infer<typeof DeleteRequestSchema>;

export const RequestInsertSchema = createInsertSchema(updateRequests, {
  eventStartTime: (s) =>
    s
      .regex(/^\d{4}$/, {
        message: "Start time must be in 24hr format (HHmm)",
      })
      // Must have literal empty string or else it fails on undefined
      .or(z.literal(""))
      .optional(),
  eventEndTime: (s) =>
    s
      .regex(/^\d{4}$/, {
        message: "End time must be in 24hr format (HHmm)",
      })
      // Must have literal empty string or else it fails on undefined
      .or(z.literal(""))
      .optional(),
  submittedBy: (s) => s.email({ message: "Invalid email address" }),
});

export type RequestInsertType = z.infer<typeof RequestInsertSchema>;

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
