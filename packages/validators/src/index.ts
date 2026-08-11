import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import {
  events,
  eventTags,
  eventTypes,
  locations,
  orgs,
  slackSpaces,
  slackUsers,
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
    .array()
    .refine(
      (roles) => {
        const orgIds = roles.map((r) => r.orgId);
        return new Set(orgIds).size === orgIds.length;
      },
      { error: "A user can only have one role per organization" },
    ),
  f3Name: z.string().optional(),
  email: z
    .email({ error: "Invalid email format" })
    .or(z.literal(""))
    .optional(),
});

// AUTH SCHEMA
export const EmailAuthSchema = UserInsertSchema.pick({
  email: true,
}).extend({
  email: z.email({ error: "Invalid email format" }),
});

// LOCATION SCHEMA
export const LocationInsertSchema = createInsertSchema(locations, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
});
export const LocationSelectSchema = createSelectSchema(locations);

// EVENT TYPE SCHEMA
export const EventTypeInsertSchema = createInsertSchema(eventTypes, {
  id: z.coerce.number().optional(),
  specificOrgId: z.coerce.number().nullish(),
  isActive: z.coerce.boolean().optional(),
  name: (s: z.ZodString) => s.min(1, { message: "Required" }),
});
export const EventTypeSelectSchema = createSelectSchema(eventTypes);

// EVENT TAG SCHEMA
export const EventTagInsertSchema = createInsertSchema(eventTags);
export const EventTagSelectSchema = createSelectSchema(eventTags);

// EVENT SCHEMA
export const EventInsertSchema = createInsertSchema(events, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  locationId: (s: z.ZodNumber) =>
    s
      .min(1, { error: "Please select an location" })
      .refine((value) => value !== -1, { error: "Invalid selection" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")),
  startTime: (s: z.ZodString) =>
    s.regex(/^\d{4}$/, {
      error: "Start time must be in 24hr format (HHmm)",
    }),
  endTime: (s: z.ZodString) =>
    s.regex(/^\d{4}$/, {
      error: "End time must be in 24hr format (HHmm)",
    }),
})
  .extend({
    regionId: z.number(),
    aoId: z.number(),
    eventTypeIds: z
      .number()
      .array()
      .min(1, { error: "Event type is required" }),
    eventTagIds: z.number().array().optional(),
  })
  .omit({
    orgId: true,
  });

const isoDateOnly = z.iso.date();

export const checkEventDateOrder = (
  data: { startDate?: unknown; endDate?: unknown },
  ctx: z.RefinementCtx,
) => {
  const startDate = isoDateOnly.safeParse(data.startDate);
  const endDate = isoDateOnly.safeParse(data.endDate);
  if (!startDate.success || !endDate.success) return;

  if (endDate.data < startDate.data) {
    ctx.addIssue({
      code: "custom",
      message: "End date must be on or after start date",
      path: ["endDate"],
    });
  }
};

export const EventCrupdateSchema = EventInsertSchema.partial({
  id: true,
}).superRefine(checkEventDateOrder);

export const EventSelectSchema = createSelectSchema(events);

export const CreateEventSchema = EventInsertSchema.omit({
  id: true,
  created: true,
  updated: true,
});
export type EventInsertType = z.infer<typeof CreateEventSchema>;

export const websiteUrlSchema = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine(
    (value) => {
      if (value === null) return true;

      try {
        const url = new URL(value);
        const { hostname } = url;

        return (
          (value.startsWith("http://") || value.startsWith("https://")) &&
          /\.[a-zA-Z]{2,}$/.test(hostname) &&
          !hostname.startsWith(".")
        );
      } catch {
        return false;
      }
    },
    {
      error: "Please enter a valid URL (e.g. https://www.example.com)",
    },
  );

const normalizeOptionalUrl = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const hasHttpProtocol = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://");

export const facebookUrlSchema = z
  .string()
  .transform(normalizeOptionalUrl)
  .refine(
    (value) => {
      if (value === null) return true;

      try {
        if (!hasHttpProtocol(value)) return false;

        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const path = url.pathname.replace(/\/+$/, "");

        const isFacebookHost =
          host === "facebook.com" ||
          host === "www.facebook.com" ||
          host === "m.facebook.com";

        if (!isFacebookHost) return false;
        if (path.startsWith("/share")) return false;
        if (path.startsWith("/sharer")) return false;

        return true;
      } catch {
        return false;
      }
    },
    {
      error:
        "Please enter a valid Facebook URL (e.g. https://www.facebook.com/f3nation)",
    },
  );

export const instagramUrlSchema = z
  .string()
  .transform(normalizeOptionalUrl)
  .refine(
    (value) => {
      if (value === null) return true;

      try {
        if (!hasHttpProtocol(value)) return false;

        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const path = url.pathname.replace(/\/+$/, "");

        const isInstagramHost =
          host === "instagram.com" || host === "www.instagram.com";

        if (!isInstagramHost) return false;

        if (
          path.startsWith("/reel") ||
          path.startsWith("/p/") ||
          path.startsWith("/explore") ||
          path.startsWith("/stories")
        ) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    {
      error:
        "Please enter a valid Instagram URL (e.g. https://www.instagram.com/f3nation)",
    },
  );

export const twitterUrlSchema = z
  .string()
  .transform(normalizeOptionalUrl)
  .refine(
    (value) => {
      if (value === null) return true;

      try {
        if (!hasHttpProtocol(value)) return false;

        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const path = url.pathname.replace(/\/+$/, "");

        const isTwitterHost =
          host === "twitter.com" ||
          host === "www.twitter.com" ||
          host === "x.com" ||
          host === "www.x.com";

        if (!isTwitterHost) return false;
        if (path.startsWith("/intent") || path.includes("/status/")) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    {
      error: "Please enter a valid X/Twitter URL (e.g. https://x.com/f3nation)",
    },
  );

export const orgPhoneSchema = z
  .string()
  .max(50, { error: "Phone number is too long" })
  .transform(normalizeOptionalUrl)
  .nullable();

// NATION SCHEMA
export const NationInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  description: (s: z.ZodString) => s.nullable(),
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
  parentId: z.null({ error: "Must not have a parent" }).optional(),
}).omit({ orgType: true });
export const NationSelectSchema = createSelectSchema(orgs);

// SECTOR SCHEMA
export const SectorInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  parentId: z
    .number({ error: "Must have a parent" })
    .nonnegative({ error: "Invalid selection" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  description: (s: z.ZodString) => s.nullable(),
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
}).omit({ orgType: true });
export const SectorSelectSchema = createSelectSchema(orgs);

// AREA SCHEMA
export const AreaInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  parentId: z
    .number({ error: "Must have a parent" })
    .nonnegative({ error: "Invalid selection" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  description: (s: z.ZodString) => s.nullable(),
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
}).omit({ orgType: true });
export const AreaSelectSchema = createSelectSchema(orgs);

// REGION SCHEMA
export const RegionInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  parentId: z
    .number({ error: "Must have a parent" })
    .nonnegative({ error: "Invalid selection" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  description: (s: z.ZodString) => s.nullable(),
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
}).omit({ orgType: true });
export const RegionSelectSchema = createSelectSchema(orgs);

// AO SCHEMA
export const AOInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  parentId: z
    .number({ error: "Must have a parent" })
    .nonnegative({ error: "Invalid selection" }),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  description: (s: z.ZodString) => s.nullable(),
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
}).omit({ orgType: true });
export const AOSelectSchema = createSelectSchema(orgs);

// ORG SCHEMA
export const OrgInsertSchema = createInsertSchema(orgs, {
  name: (s: z.ZodString) => s.min(1, { error: "Name is required" }),
  parentId: z
    .number({ error: "Must have a parent" })
    .nonnegative({ error: "Invalid selection" })
    .nullable(),
  description: (s: z.ZodString) => s.nullable(),
  email: (s: z.ZodString) =>
    s.email({ error: "Invalid email format" }).or(z.literal("")).nullable(),
  phone: orgPhoneSchema,
  website: websiteUrlSchema.nullable(),
  twitter: twitterUrlSchema.nullable(),
  facebook: facebookUrlSchema.nullable(),
  instagram: instagramUrlSchema.nullable(),
});
export const OrgSelectSchema = createSelectSchema(orgs);

export const RequestInsertSchema = createInsertSchema(updateRequests, {
  eventTypeIds: (s: z.ZodArray<z.ZodNumber>) =>
    s.min(1, { error: "Please select at least one event type" }),
  eventName: (s: z.ZodString) =>
    s.min(1, { error: "Workout name is required" }),
  // We don't want to require an event description
  // eventDescription: (s) => s.min(1, { message: "Description is required" }),
  eventDayOfWeek: z
    .enum(DayOfWeek, {
      message: "Day of the week is required",
    })
    .nullish(),
  aoName: (s: z.ZodString) => s.min(1, { message: "AO name is required" }),
  // Location fields are optional
  // locationAddress: (s) => s.min(1, { error: "Location address is required" }),
  // locationCity: (s) => s.min(1, { error: "Location city is required" }),
  // locationState: (s) => s.min(1, { error: "Location state is required" }),
  // locationZip: (s) => s.min(1, { error: "Location zip is required" }),
  // locationCountry: (s) => s.min(1, { error: "Location country is required" }),
  regionId: z.number({ error: "Region is required" }),
  eventStartTime: (s: z.ZodString) =>
    s.regex(/^\d{4}$/, {
      error: "Start time must be in 24hr format (HHmm)",
    }),
  eventEndTime: (s: z.ZodString) =>
    s.regex(/^\d{4}$/, {
      error: "End time must be in 24hr format (HHmm)",
    }),
  submittedBy: (s: z.ZodString) => s.email({ error: "Invalid email address" }),
}).extend({
  id: z.string(),
  eventMeta: z.record(z.string(), z.unknown()).optional(),
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
      z.string().nullable(), // ao org name
      z.string().nullable(), // ao org logo
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
  deleteRequest: createInsertSchema(updateRequests).partial(),
});

export type DeleteRequestResponse = z.infer<typeof DeleteRequestResponseSchema>;

// SLACK SCHEMA
export const CustomFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "select", "multi_select", "user_select"]),
  options: z.array(z.string()).optional(),
  enabled: z.boolean(),
});

export const SlackSettingsSchema = z.object({
  welcome_dm_enable: z.boolean().optional(),
  welcome_dm_template: z.string().optional(),
  welcome_channel_enable: z.boolean().optional(),
  welcome_channel: z.string().optional(),
  editing_locked: z.boolean().optional(),
  default_backblast_destination: z.string().optional(),
  backblast_destination_channel: z.string().optional(),
  default_preblast_destination: z.string().optional(),
  preblast_destination_channel: z.string().optional(),
  backblast_moleskin_template: z.string().optional(),
  preblast_moleskin_template: z.string().optional(),
  strava_enabled: z.boolean().optional(),
  preblast_reminder_days: z.number().optional(),
  backblast_reminder_days: z.number().optional(),
  automated_preblast_option: z.string().optional(),
  automated_preblast_hour_cst: z.number().optional(),
  custom_fields: z.array(CustomFieldSchema).optional(),
});

export const SlackSpaceSelectSchema = createSelectSchema(slackSpaces);
export const SlackSpaceInsertSchema = createInsertSchema(slackSpaces);

export const SlackUserSelectSchema = createSelectSchema(slackUsers);
export const SlackUserInsertSchema = createInsertSchema(slackUsers);

export const SlackUserUpsertSchema = z.object({
  slackId: z.string(),
  userName: z.string(),
  email: z.email().optional(),
  teamId: z.string(),
  userId: z.number().optional(),
  isAdmin: z.boolean().default(false),
  isOwner: z.boolean().default(false),
  isBot: z.boolean().default(false),
});

// POSITION SCHEMA
import { positions, positionsXOrgsXUsers } from "@acme/db/schema/schema";

export const PositionSelectSchema = createSelectSchema(positions);
export const PositionInsertSchema = createInsertSchema(positions);

export type PositionSelectType = z.infer<typeof PositionSelectSchema>;
export type PositionInsertType = z.infer<typeof PositionInsertSchema>;

export const PositionAssignmentSelectSchema =
  createSelectSchema(positionsXOrgsXUsers);
export const PositionAssignmentInsertSchema =
  createInsertSchema(positionsXOrgsXUsers);

export type PositionAssignmentSelectType = z.infer<
  typeof PositionAssignmentSelectSchema
>;
export type PositionAssignmentInsertType = z.infer<
  typeof PositionAssignmentInsertSchema
>;

/**
 * Schema for bulk updating position assignments for an org
 * @deprecated Use AddPositionAssignmentSchema for individual inserts instead
 */
export const UpdatePositionAssignmentsSchema = z.object({
  /** The org (AO or region) the assignments are for */
  orgId: z.number(),
  /** Array of position assignments: which users hold which positions */
  assignments: z.array(
    z.object({
      positionId: z.number(),
      userIds: z.array(z.number()),
    }),
  ),
});

export const AddPositionAssignmentSchema = z.object({
  positionId: z.coerce.number().describe("The ID of the position to assign"),
  orgId: z.coerce
    .number()
    .describe("The ID of the organization for the assignment"),
  userId: z.coerce
    .number()
    .describe("The ID of the user to assign to the position"),
});

export const GetAllPositionAssignmentsSchema = z.object({
  orgId: z.coerce.number().optional().describe("Filter by organization ID"),
  positionId: z.coerce.number().optional().describe("Filter by position ID"),
  userId: z.coerce.number().optional().describe("Filter by user ID"),
  includeInactive: z.coerce
    .boolean()
    .optional()
    .default(false)
    .describe("Include assignments for inactive positions, orgs, or users"),
});
