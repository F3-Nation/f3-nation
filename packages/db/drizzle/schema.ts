import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  AchievementCadence,
  DayOfWeek,
  EventCadence,
  EventCategory,
  OrgType,
  RegionRole,
  RequestType,
  SeriesException,
  UpdateRequestStatus,
  UserRole,
  UserStatus,
} from "@acme/shared/app/enums";
import type {
  AchievementAwardMeta,
  AttendanceMeta,
  EventMeta,
  LocationMeta,
  OrgMeta,
  SlackSpacesMeta,
  SlackUserMeta,
  UpdateRequestMeta,
  UserMeta,
} from "@acme/shared/app/types";

export const userRole = pgEnum("user_role", UserRole);
export const dayOfWeek = pgEnum("day_of_week", DayOfWeek);
export const eventCadence = pgEnum("event_cadence", EventCadence);
export const eventCategory = pgEnum("event_category", EventCategory);
export const seriesException = pgEnum("series_exception", SeriesException);
export const orgType = pgEnum("org_type", OrgType);
export const regionRole = pgEnum("region_role", RegionRole);
export const updateRequestStatus = pgEnum(
  "update_request_status",
  UpdateRequestStatus,
);
export const userStatus = pgEnum("user_status", UserStatus);
export const requestType = pgEnum("request_type", RequestType);
export const achievementCadence = pgEnum(
  "achievement_cadence",
  AchievementCadence,
);

export const citext = customType<{ data: string }>({
  fromDriver(value) {
    return value as string;
  },
  toDriver(value) {
    return value;
  },
  dataType() {
    return "citext";
  },
});

export const alembicVersion = pgTable("alembic_version", {
  versionNum: varchar("version_num", { length: 32 }).primaryKey().notNull(),
});

export const eventInstances = pgTable(
  "event_instances",
  {
    id: serial().primaryKey().notNull(),
    orgId: integer("org_id").notNull(),
    locationId: integer("location_id"),
    seriesId: integer("series_id"),
    isActive: boolean("is_active").notNull(),
    highlight: boolean().notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    startTime: varchar("start_time"),
    endTime: varchar("end_time"),
    name: varchar().notNull(),
    description: varchar(),
    email: varchar(),
    paxCount: integer("pax_count"),
    fngCount: integer("fng_count"),
    preblast: varchar(),
    backblast: varchar(),
    preblastRich: jsonb("preblast_rich"),
    backblastRich: jsonb("backblast_rich"),
    preblastTs: doublePrecision("preblast_ts"),
    backblastTs: doublePrecision("backblast_ts"),
    isPrivate: boolean("is_private").default(false).notNull(),
    seriesException: seriesException("series_exception"),
    meta: jsonb(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    index("idx_event_instances_is_active").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
    ),
    index("idx_event_instances_location_id").using(
      "btree",
      table.locationId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_event_instances_org_id").using(
      "btree",
      table.orgId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_event_instances_start_date").using(
      "btree",
      table.startDate.asc().nullsLast().op("date_ops"),
    ),
    index("idx_event_instances_start_date_active")
      .using("btree", table.startDate.asc().nullsLast().op("date_ops"))
      .where(sql`is_active`),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: "event_instances_location_id_fkey",
    }),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "event_instances_org_id_fkey",
    }),
    foreignKey({
      columns: [table.seriesId],
      foreignColumns: [events.id],
      name: "event_instances_series_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const permissions = pgTable("permissions", {
  id: serial().primaryKey().notNull(),
  name: varchar().notNull(),
  description: varchar(),
  created: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  updated: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
});

export const slackSpaces = pgTable(
  "slack_spaces",
  {
    id: serial().primaryKey().notNull(),
    teamId: varchar("team_id").notNull(),
    workspaceName: varchar("workspace_name"),
    botToken: varchar("bot_token"),
    settings: jsonb().$type<SlackSpacesMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [unique("slack_spaces_team_id_key").on(table.teamId)],
);

export const expansions = pgTable("expansions", {
  id: serial().primaryKey().notNull(),
  area: varchar().notNull(),
  pinnedLat: doublePrecision("pinned_lat").notNull(),
  pinnedLon: doublePrecision("pinned_lon").notNull(),
  userLat: doublePrecision("user_lat").notNull(),
  userLon: doublePrecision("user_lon").notNull(),
  interestedInOrganizing: boolean("interested_in_organizing").notNull(),
  created: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  updated: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
});

export const slackUsers = pgTable(
  "slack_users",
  {
    id: serial().primaryKey().notNull(),
    slackId: varchar("slack_id").notNull(),
    userName: varchar("user_name").notNull(),
    email: varchar().notNull(),
    isAdmin: boolean("is_admin").notNull(),
    isOwner: boolean("is_owner").notNull(),
    isBot: boolean("is_bot").notNull(),
    userId: integer("user_id"),
    avatarUrl: varchar("avatar_url"),
    slackTeamId: varchar("slack_team_id").notNull(),
    stravaAccessToken: varchar("strava_access_token"),
    stravaRefreshToken: varchar("strava_refresh_token"),
    stravaExpiresAt: timestamp("strava_expires_at", { mode: "string" }),
    stravaAthleteId: integer("strava_athlete_id"),
    meta: jsonb().$type<SlackUserMeta>(),
    slackUpdated: integer("slack_updated"),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    index("idx_slack_users_user_team_id").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.slackTeamId.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "slack_users_user_id_fkey",
    }),
  ],
);

export const attendance = pgTable(
  "attendance",
  {
    id: serial().primaryKey().notNull(),
    userId: integer("user_id").notNull(),
    isPlanned: boolean("is_planned").notNull(),
    meta: jsonb().$type<AttendanceMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    eventInstanceId: integer("event_instance_id").notNull(),
  },
  (table) => [
    index("idx_attendance_event_instance_id").using(
      "btree",
      table.eventInstanceId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.eventInstanceId],
      foreignColumns: [eventInstances.id],
      name: "event_instance_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "attendance_user_id_fkey",
    }),
    unique("attendance_event_instance_id_user_id_is_planned_key").on(
      table.userId,
      table.isPlanned,
      table.eventInstanceId,
    ),
  ],
);

export const attendanceTypes = pgTable("attendance_types", {
  id: serial().primaryKey().notNull(),
  type: varchar().notNull(),
  description: varchar(),
  created: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  updated: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
});

export const locations = pgTable(
  "locations",
  {
    id: serial().primaryKey().notNull(),
    orgId: integer("org_id").notNull(),
    name: varchar().notNull(),
    description: varchar(),
    isActive: boolean("is_active").notNull(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    addressStreet: varchar("address_street"),
    addressCity: varchar("address_city"),
    addressState: varchar("address_state"),
    addressZip: varchar("address_zip"),
    addressCountry: varchar("address_country"),
    meta: jsonb().$type<LocationMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    email: varchar(),
    addressStreet2: varchar("address_street2"),
  },
  (table) => [
    index("idx_locations_is_active").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
    ),
    index("idx_locations_name").using(
      "btree",
      table.name.asc().nullsLast().op("text_ops"),
    ),
    index("idx_locations_org_id").using(
      "btree",
      table.orgId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "locations_org_id_fkey",
    }),
  ],
);

export const eventTags = pgTable(
  "event_tags",
  {
    id: serial().primaryKey().notNull(),
    name: varchar().notNull(),
    description: varchar(),
    color: varchar(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    specificOrgId: integer("specific_org_id"),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.specificOrgId],
      foreignColumns: [orgs.id],
      name: "event_tags_specific_org_id_fkey",
    }),
  ],
);

export const roles = pgTable("roles", {
  id: serial().primaryKey().notNull(),
  name: regionRole().notNull(),
  description: varchar(),
  created: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  updated: timestamp({ mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
});

export const users = pgTable(
  "users",
  {
    id: serial().primaryKey().notNull(),
    f3Name: varchar("f3_name"),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    email: citext("email").notNull(),
    phone: varchar(),
    homeRegionId: integer("home_region_id"),
    avatarUrl: varchar("avatar_url"),
    meta: jsonb().$type<UserMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    emergencyContact: varchar("emergency_contact"),
    emergencyPhone: varchar("emergency_phone"),
    emergencyNotes: varchar("emergency_notes"),
    emailVerified: timestamp("email_verified", { mode: "string" }),
    status: userStatus().default("active").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.homeRegionId],
      foreignColumns: [orgs.id],
      name: "users_home_region_id_fkey",
    }),
    unique("users_email_key").on(table.email),
  ],
);

export const achievements = pgTable(
  "achievements",
  {
    id: serial().primaryKey().notNull(),
    name: varchar().notNull(),
    description: varchar(),
    imageUrl: varchar("image_url"),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    specificOrgId: integer("specific_org_id"),
    isActive: boolean("is_active").default(true).notNull(),
    autoAward: boolean("auto_award").default(false).notNull(),
    autoCadence: achievementCadence("auto_cadence"),
    autoThresholdType: varchar("auto_threshold_type"),
    autoThreshold: integer("auto_threshold"),
    autoFilters: jsonb("auto_filters"),
    meta: jsonb(),
  },
  (table) => [
    foreignKey({
      columns: [table.specificOrgId],
      foreignColumns: [orgs.id],
      name: "achievements_specific_org_id_fkey",
    }),
  ],
);

export const eventTypes = pgTable(
  "event_types",
  {
    id: serial().primaryKey().notNull(),
    name: varchar().notNull(),
    description: varchar(),
    acronym: varchar(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    specificOrgId: integer("specific_org_id"),
    eventCategory: eventCategory("event_category").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.specificOrgId],
      foreignColumns: [orgs.id],
      name: "event_types_specific_org_id_fkey",
    }),
  ],
);

export const orgs = pgTable(
  "orgs",
  {
    id: serial().primaryKey().notNull(),
    parentId: integer("parent_id"),
    defaultLocationId: integer("default_location_id"),
    name: varchar().notNull(),
    description: varchar(),
    isActive: boolean("is_active").notNull(),
    logoUrl: varchar("logo_url"),
    website: varchar(),
    email: varchar(),
    phone: varchar(),
    twitter: varchar(),
    facebook: varchar(),
    instagram: varchar(),
    lastAnnualReview: date("last_annual_review"),
    aoCount: integer("ao_count").default(0),
    meta: jsonb().$type<OrgMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    orgType: orgType("org_type").notNull(),
  },
  (table) => [
    index("idx_orgs_is_active").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
    ),
    index("idx_orgs_org_type").using(
      "btree",
      table.orgType.asc().nullsLast().op("enum_ops"),
    ),
    index("idx_orgs_parent_id").using(
      "btree",
      table.parentId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "orgs_parent_id_fkey",
    }),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: serial().primaryKey().notNull(),
    name: varchar().notNull(),
    description: varchar(),
    orgId: integer("org_id"),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    orgType: orgType("org_type"),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "positions_org_id_fkey",
    }),
  ],
);

export const events = pgTable(
  "events",
  {
    id: serial().primaryKey().notNull(),
    orgId: integer("org_id").notNull(),
    locationId: integer("location_id"),
    seriesId: integer("series_id"),
    isActive: boolean("is_active").notNull(),
    highlight: boolean().notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    startTime: varchar("start_time"),
    endTime: varchar("end_time"),
    dayOfWeek: dayOfWeek("day_of_week"),
    name: varchar().notNull(),
    description: varchar(),
    recurrencePattern: eventCadence("recurrence_pattern"),
    recurrenceInterval: integer("recurrence_interval"),
    indexWithinInterval: integer("index_within_interval"),
    meta: jsonb().$type<EventMeta>(),
    isPrivate: boolean("is_private").default(false).notNull(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    email: varchar(),
  },
  (table) => [
    index("idx_events_is_active").using(
      "btree",
      table.isActive.asc().nullsLast().op("bool_ops"),
    ),
    index("idx_events_location_id").using(
      "btree",
      table.locationId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_events_org_id").using(
      "btree",
      table.orgId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: "events_location_id_fkey",
    }),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "events_org_id_fkey",
    }),
    foreignKey({
      columns: [table.seriesId],
      foreignColumns: [table.id],
      name: "events_series_id_fkey",
    }),
  ],
);

export const updateRequests = pgTable(
  "update_requests",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    token: uuid().defaultRandom().notNull(),
    regionId: integer("region_id").notNull(),
    eventId: integer("event_id"),
    eventTypeIds: integer("event_type_ids").array(),
    eventTag: varchar("event_tag"),
    eventSeriesId: integer("event_series_id"),
    eventIsSeries: boolean("event_is_series"),
    eventIsActive: boolean("event_is_active"),
    eventHighlight: boolean("event_highlight"),
    eventStartDate: date("event_start_date"),
    eventEndDate: date("event_end_date"),
    eventStartTime: varchar("event_start_time"),
    eventEndTime: varchar("event_end_time"),
    eventDayOfWeek: dayOfWeek("event_day_of_week"),
    eventName: varchar("event_name"),
    eventDescription: varchar("event_description"),
    eventRecurrencePattern: eventCadence("event_recurrence_pattern"),
    eventRecurrenceInterval: integer("event_recurrence_interval"),
    eventIndexWithinInterval: integer("event_index_within_interval"),
    eventMeta: jsonb("event_meta").$type<EventMeta>(),
    eventContactEmail: varchar("event_contact_email"),
    locationName: varchar("location_name"),
    locationDescription: varchar("location_description"),
    locationAddress: varchar("location_address"),
    locationAddress2: varchar("location_address2"),
    locationCity: varchar("location_city"),
    locationState: varchar("location_state"),
    locationZip: varchar("location_zip"),
    locationCountry: varchar("location_country"),
    locationLat: real("location_lat"),
    locationLng: real("location_lng"),
    locationId: integer("location_id"),
    locationContactEmail: varchar("location_contact_email"),
    aoId: integer("ao_id"),
    aoName: varchar("ao_name"),
    aoLogo: varchar("ao_logo"),
    aoWebsite: varchar("ao_website"),
    submittedBy: varchar("submitted_by").notNull(),
    submitterValidated: boolean("submitter_validated"),
    reviewedBy: varchar("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { mode: "string" }),
    status: updateRequestStatus().default("pending").notNull(),
    meta: jsonb().$type<UpdateRequestMeta>(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    requestType: requestType("request_type").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
      name: "update_requests_event_id_fkey",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.locationId],
      foreignColumns: [locations.id],
      name: "update_requests_location_id_fkey",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.regionId],
      foreignColumns: [orgs.id],
      name: "update_requests_region_id_fkey",
    }).onDelete("no action"),
  ],
);

export const eventInstancesXEventTypes = pgTable(
  "event_instances_x_event_types",
  {
    eventInstanceId: integer("event_instance_id").notNull(),
    eventTypeId: integer("event_type_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventInstanceId],
      foreignColumns: [eventInstances.id],
      name: "event_instances_x_event_types_event_instance_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.eventTypeId],
      foreignColumns: [eventTypes.id],
      name: "event_instances_x_event_types_event_type_id_fkey",
    }),
    primaryKey({
      columns: [table.eventInstanceId, table.eventTypeId],
      name: "event_instances_x_event_types_pkey",
    }),
  ],
);

export const eventTagsXEventInstances = pgTable(
  "event_tags_x_event_instances",
  {
    eventInstanceId: integer("event_instance_id").notNull(),
    eventTagId: integer("event_tag_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventInstanceId],
      foreignColumns: [eventInstances.id],
      name: "event_tags_x_event_instances_event_instance_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.eventTagId],
      foreignColumns: [eventTags.id],
      name: "event_tags_x_event_instances_event_tag_id_fkey",
    }),
    primaryKey({
      columns: [table.eventInstanceId, table.eventTagId],
      name: "event_tags_x_event_instances_pkey",
    }),
  ],
);

export const rolesXPermissions = pgTable(
  "roles_x_permissions",
  {
    roleId: integer("role_id").notNull(),
    permissionId: integer("permission_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.permissionId],
      foreignColumns: [permissions.id],
      name: "roles_x_permissions_permission_id_fkey",
    }),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: "roles_x_permissions_role_id_fkey",
    }),
    primaryKey({
      columns: [table.roleId, table.permissionId],
      name: "roles_x_permissions_pkey",
    }),
  ],
);

export const eventTagsXEvents = pgTable(
  "event_tags_x_events",
  {
    eventId: integer("event_id").notNull(),
    eventTagId: integer("event_tag_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
      name: "event_tags_x_events_event_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.eventTagId],
      foreignColumns: [eventTags.id],
      name: "event_tags_x_events_event_tag_id_fkey",
    }),
    primaryKey({
      columns: [table.eventId, table.eventTagId],
      name: "event_tags_x_events_pkey",
    }),
  ],
);

export const eventsXEventTypes = pgTable(
  "events_x_event_types",
  {
    eventId: integer("event_id").notNull(),
    eventTypeId: integer("event_type_id").notNull(),
  },
  (table) => [
    index("idx_events_x_event_types_event_id").using(
      "btree",
      table.eventId.asc().nullsLast().op("int4_ops"),
    ),
    index("idx_events_x_event_types_event_type_id").using(
      "btree",
      table.eventTypeId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
      name: "events_x_event_types_event_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.eventTypeId],
      foreignColumns: [eventTypes.id],
      name: "events_x_event_types_event_type_id_fkey",
    }),
    primaryKey({
      columns: [table.eventId, table.eventTypeId],
      name: "events_x_event_types_pkey",
    }),
  ],
);

export const attendanceXAttendanceTypes = pgTable(
  "attendance_x_attendance_types",
  {
    attendanceId: integer("attendance_id").notNull(),
    attendanceTypeId: integer("attendance_type_id").notNull(),
  },
  (table) => [
    index("idx_attendance_x_types_type_id").using(
      "btree",
      table.attendanceTypeId.asc().nullsLast().op("int4_ops"),
    ),
    foreignKey({
      columns: [table.attendanceId],
      foreignColumns: [attendance.id],
      name: "attendance_x_attendance_types_attendance_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.attendanceTypeId],
      foreignColumns: [attendanceTypes.id],
      name: "attendance_x_attendance_types_attendance_type_id_fkey",
    }),
    primaryKey({
      columns: [table.attendanceId, table.attendanceTypeId],
      name: "attendance_x_attendance_types_pkey",
    }),
  ],
);

export const orgsXSlackSpaces = pgTable(
  "orgs_x_slack_spaces",
  {
    orgId: integer("org_id").notNull(),
    slackSpaceId: integer("slack_space_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "orgs_x_slack_spaces_org_id_fkey",
    }),
    foreignKey({
      columns: [table.slackSpaceId],
      foreignColumns: [slackSpaces.id],
      name: "orgs_x_slack_spaces_slack_space_id_fkey",
    }),
    primaryKey({
      columns: [table.orgId, table.slackSpaceId],
      name: "orgs_x_slack_spaces_pkey",
    }),
  ],
);

export const achievementsXUsers = pgTable(
  "achievements_x_users",
  {
    achievementId: integer("achievement_id").notNull(),
    userId: integer("user_id").notNull(),
    awardYear: integer("award_year").notNull().default(-1),
    awardPeriod: integer("award_period").notNull().default(-1),
    dateAwarded: timestamp("date_awarded", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    meta: jsonb().$type<AchievementAwardMeta>(),
  },
  (table) => [
    foreignKey({
      columns: [table.achievementId],
      foreignColumns: [achievements.id],
      name: "achievements_x_users_achievement_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "achievements_x_users_user_id_fkey",
    }),
    primaryKey({
      columns: [
        table.achievementId,
        table.userId,
        table.awardYear,
        table.awardPeriod,
      ],
      name: "achievements_x_users_pkey",
    }),
  ],
);

export const positionsXOrgsXUsers = pgTable(
  "positions_x_orgs_x_users",
  {
    positionId: integer("position_id").notNull(),
    orgId: integer("org_id").notNull(),
    userId: integer("user_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "positions_x_orgs_x_users_org_id_fkey",
    }),
    foreignKey({
      columns: [table.positionId],
      foreignColumns: [positions.id],
      name: "positions_x_orgs_x_users_position_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "positions_x_orgs_x_users_user_id_fkey",
    }),
    primaryKey({
      columns: [table.positionId, table.orgId, table.userId],
      name: "positions_x_orgs_x_users_pkey",
    }),
  ],
);

export const rolesXUsersXOrg = pgTable(
  "roles_x_users_x_org",
  {
    roleId: integer("role_id").notNull(),
    userId: integer("user_id").notNull(),
    orgId: integer("org_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "roles_x_users_x_org_org_id_fkey",
    }),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: "roles_x_users_x_org_role_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "roles_x_users_x_org_user_id_fkey",
    }),
    primaryKey({
      columns: [table.roleId, table.userId, table.orgId],
      name: "roles_x_users_x_org_pkey",
    }),
  ],
);

export const expansionsXUsers = pgTable(
  "expansions_x_users",
  {
    expansionId: integer("expansion_id").notNull(),
    userId: integer("user_id").notNull(),
    requestDate: timestamp("request_date", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    notes: varchar(),
  },
  (table) => [
    foreignKey({
      columns: [table.expansionId],
      foreignColumns: [expansions.id],
      name: "expansions_x_users_expansion_id_fkey",
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "expansions_x_users_user_id_fkey",
    }),
    primaryKey({
      columns: [table.expansionId, table.userId],
      name: "expansions_x_users_pkey",
    }),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: integer("user_id").notNull(),
    type: varchar().notNull(),
    provider: varchar().notNull(),
    providerAccountId: varchar("provider_account_id").notNull(),
    refreshToken: varchar("refresh_token"),
    accessToken: varchar("access_token"),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    tokenType: varchar("token_type"),
    scope: varchar(),
    idToken: varchar("id_token"),
    sessionState: varchar("session_state"),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "auth_accounts_user_id_fkey",
    }),
    primaryKey({
      columns: [table.provider, table.providerAccountId],
      name: "auth_accounts_pkey",
    }),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    sessionToken: text("session_token").primaryKey().notNull(),
    userId: integer("user_id").notNull(),
    expires: timestamp({ mode: "string" }).notNull(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "auth_sessions_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: varchar().notNull(),
    token: varchar().notNull(),
    expires: timestamp({ mode: "string" }).notNull(),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
      name: "auth_verification_tokens_pkey",
    }),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial().primaryKey().notNull(),
    key: varchar().notNull(),
    name: varchar().notNull(),
    description: varchar(),
    ownerId: integer("owner_id"),
    revokedAt: timestamp("revoked_at", { mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { mode: "string" }),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    created: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updated: timestamp({ mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [
    unique("api_keys_key_key").on(table.key),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "api_keys_owner_id_fkey",
    }),
  ],
);

export const rolesXApiKeysXOrg = pgTable(
  "roles_x_api_keys_x_org",
  {
    roleId: integer("role_id").notNull(),
    apiKeyId: integer("api_key_id").notNull(),
    orgId: integer("org_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: "roles_x_api_keys_x_org_role_id_fkey",
    }),
    foreignKey({
      columns: [table.apiKeyId],
      foreignColumns: [apiKeys.id],
      name: "roles_x_api_keys_x_org_api_key_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "roles_x_api_keys_x_org_org_id_fkey",
    }),
    primaryKey({
      columns: [table.roleId, table.apiKeyId, table.orgId],
      name: "roles_x_api_keys_x_org_pkey",
    }),
  ],
);

// ---------------------------------------------------------------------------
// Auth schema — OAuth 2.0 / OIDC tables owned by apps/auth
// ---------------------------------------------------------------------------

export const authProviderSchema = pgSchema("auth");

export const oauthClients = authProviderSchema.table("oauth_clients", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  clientSecretHash: text("client_secret_hash").notNull(),
  redirectUris: text("redirect_uris").notNull(), // JSON array
  allowedOrigin: text("allowed_origin").notNull(),
  scopes: text().default("openid profile email"),
  createdAt: timestamp("created_at", { mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // Public clients (RFC 8252 native apps) cannot keep a client_secret
  // confidential; token exchange for them relies on PKCE instead of the
  // secret. Confidential (default) clients still require the secret.
  isPublic: boolean("is_public").default(false).notNull(),
});

export const oauthAuthorizationCodes = authProviderSchema.table(
  "oauth_authorization_codes",
  {
    code: text().primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text(),
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    // OIDC replay-protection value from the original /authorize request,
    // echoed verbatim into the id_token's own nonce claim at code exchange.
    // Null when the client didn't send one (nonce is optional per spec).
    nonce: text(),
    // When the end user actually authenticated (their NextAuth session's
    // original sign-in, not this authorize request, which can reuse an
    // existing session much later) — becomes the id_token's auth_time
    // claim, and is carried forward onto the refresh token row below so
    // every subsequent refresh can keep reporting the true original login
    // instead of resetting to "now" on each rotation.
    authTime: timestamp("auth_time", { mode: "string" }),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
);

export const oauthAccessTokens = authProviderSchema.table(
  "oauth_access_tokens",
  {
    token: text().primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    scopes: text(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
);

export const oauthRefreshTokens = authProviderSchema.table(
  "oauth_refresh_tokens",
  {
    token: text().primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    // Set (instead of deleting the row) when this token is consumed by a
    // refresh-token rotation. Kept around, distinct from natural expiry via
    // expiresAt, so a later presentation of this exact token can be told
    // apart from a garbage/never-issued token — see exchangeRefreshToken's
    // reuse-detection path (RFC 9700 §4.14.2).
    rotatedAt: timestamp("rotated_at", { mode: "string" }),
    // The scopes actually granted when this refresh token's lineage was
    // first issued (carried forward on every rotation). Without this,
    // exchangeRefreshToken had no way to recover the real grant and fell
    // back to the client's full registered scope — looser than the
    // authorization_code path, and the reason the refresh grant couldn't
    // enforce the same openid-gating rules that path already had.
    scopes: text(),
    // Carried forward from the authorization code that started this
    // token's lineage (see oauthAuthorizationCodes.authTime) — every
    // rotation reuses the same original value rather than resetting to
    // "now", so a relying party can still tell a 29-day-old login from a
    // fresh one purely from the auth_time claim.
    authTime: timestamp("auth_time", { mode: "string" }),
  },
);

export const emailMfaCodes = authProviderSchema.table("email_mfa_codes", {
  id: text().primaryKey().notNull(), // UUID
  email: text().notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { mode: "string" }),
  attemptCount: integer("attempt_count").default(0).notNull(),
  createdAt: timestamp("created_at", { mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
});

// ---------------------------------------------------------------------------
// Better Auth tables (Phase 3, #876) — DRAFTED, NOT APPLIED. See
// docs/AI_GUARDRAILS.md's schema-migration sign-off rule for what that means.
// Included here so the shape can be reviewed alongside the code that depends
// on it; nothing above this point is touched, and the existing oauth_* tables
// keep serving the hand-rolled OAuth server unchanged regardless of whether
// this migration is ever applied.
//
// Field shapes were not hand-derived from docs — they're the literal output
// of `getAuthTables()` (from @better-auth/core/db) run against this app's
// actual plugin stack (emailOTP + jwt + oauthProvider + bearer), so this
// schema matches exactly what the adapter in
// apps/auth/src/lib/better-auth.ts will read and write, not a guess at it.
//
// `betterAuthUser.id` deliberately holds the existing `users.id`, cast to
// text, rather than a separately-generated id. See the
// `databaseHooks.user.create.before` bridge in apps/auth/src/lib/
// better-auth.ts — that's what keeps `sub` on a Better Auth-issued access
// token equal to the same numeric user id every existing verifier
// (packages/sso's isAccessTokenPayload, apps/auth's own /userinfo, etc.)
// already expects, instead of minting a second, unrelated identity space
// that nothing downstream knows how to resolve.
// ---------------------------------------------------------------------------

export const betterAuthUser = authProviderSchema.table(
  "better_auth_user",
  {
    id: text().primaryKey().notNull(), // == users.id as a string, see block comment above
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
  (table) => [unique("better_auth_user_email_key").on(table.email)],
);

export const betterAuthSession = authProviderSchema.table(
  "better_auth_session",
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    token: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
  },
  (table) => [unique("better_auth_session_token_key").on(table.token)],
);

// Part of Better Auth's core schema unconditionally (present regardless of
// which plugins are enabled) even though this app's plugin stack — emailOTP
// only, no social login, no email/password — never writes to it today.
export const betterAuthAccount = authProviderSchema.table(
  "better_auth_account",
  {
    id: text().primaryKey().notNull(),
    issuer: text().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "string",
    }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
);

// Backs the emailOTP plugin's one-time codes (this app's Better Auth
// equivalent of the existing email_mfa_codes table above — kept separate
// rather than reusing it, since Better Auth owns this table's shape).
export const betterAuthVerification = authProviderSchema.table(
  "better_auth_verification",
  {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .default(sql`timezone('utc'::text, now())`)
      .notNull(),
  },
);

// Backs the jwt plugin's RS256 signing key. Whether this ends up being the
// live signing key (self-generated here) or a wrapper around the existing
// AUTH_JWT_PRIVATE_KEY / fixed "f3-auth-1" kid the hand-rolled server uses
// today is an open Phase 3/4 question (JWKS continuity across the two
// issuers) — flagged in the PR description, not resolved by this schema.
export const betterAuthJwks = authProviderSchema.table("better_auth_jwks", {
  id: text().primaryKey().notNull(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { mode: "string" })
    .default(sql`timezone('utc'::text, now())`)
    .notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }),
  alg: text(),
  crv: text(),
});

// The oauthProvider plugin's own client registry — deliberately separate
// from oauth_clients above rather than a reshape of it. oauth_clients keeps
// serving the hand-rolled server unmodified; migrating existing client rows
// (admin, me, Digital Weinke) into this table is a one-time data migration
// script, not a schema change — see apps/auth/scripts/migrate-oauth-clients-
// to-better-auth.ts. Team decision (#876 thread, 2026-08-28): confidential
// clients' secrets are NOT migrated — Better Auth's own default secret
// hashing is preferred over matching oauth_clients.client_secret_hash's
// sha256 scheme, so admin/me need a new secret issued at cutover (open
// question, see that script's file comment).
export const betterAuthOauthClient = authProviderSchema.table(
  "better_auth_oauth_client",
  {
    id: text().primaryKey().notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean(),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text().array(),
    clientCredentialsScopes: text("client_credentials_scopes").array(),
    userId: text("user_id").references(() => betterAuthUser.id),
    createdAt: timestamp("created_at", { mode: "string" }),
    updatedAt: timestamp("updated_at", { mode: "string" }),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text().array(),
    tos: text(),
    policy: text(),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required",
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text(),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    // Every client mapped from oauth_clients gets requirePKCE: true
    // regardless of confidential/public, matching the hand-rolled server's
    // current behavior (validateCodeVerifier is enforced unconditionally in
    // apps/auth/src/lib/oauth.ts, stricter than plain OAuth 2.1's
    // public-clients-only baseline) — this column is where that decision is
    // actually recorded per client, not assumed globally.
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens"),
    referenceId: text("reference_id"),
    metadata: jsonb(),
  },
  (table) => [
    unique("better_auth_oauth_client_client_id_key").on(table.clientId),
  ],
);

// The oauthProvider plugin's protected-resource registry. This app registers
// exactly one resource (the auth server's own issuer URL) with
// signingAlgorithm: "RS256" — without a registered resource, oauth-provider
// issues opaque reference access tokens instead of self-contained JWTs (see
// apps/auth/src/lib/better-auth.ts), and the hand-rolled server has always
// issued JWT access tokens.
export const betterAuthOauthResource = authProviderSchema.table(
  "better_auth_oauth_resource",
  {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    name: text().notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required"),
    disabled: boolean(),
    createdAt: timestamp("created_at", { mode: "string" }),
    updatedAt: timestamp("updated_at", { mode: "string" }),
    policyVersion: integer("policy_version"),
    metadata: jsonb(),
  },
  (table) => [
    unique("better_auth_oauth_resource_identifier_key").on(table.identifier),
  ],
);

export const betterAuthOauthClientResource = authProviderSchema.table(
  "better_auth_oauth_client_resource",
  {
    id: text().primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOauthClient.clientId, {
        onDelete: "cascade",
      }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => betterAuthOauthResource.identifier, {
        onDelete: "cascade",
      }),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { mode: "string" }),
  },
);

export const betterAuthOauthRefreshToken = authProviderSchema.table(
  "better_auth_oauth_refresh_token",
  {
    id: text().primaryKey().notNull(),
    token: text().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOauthClient.clientId),
    sessionId: text("session_id").references(() => betterAuthSession.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => betterAuthUser.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text().array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }),
    revoked: timestamp({ mode: "string" }),
    rotatedAt: timestamp("rotated_at", { mode: "string" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
      mode: "string",
    }),
    authTime: timestamp("auth_time", { mode: "string" }),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (table) => [
    unique("better_auth_oauth_refresh_token_token_key").on(table.token),
  ],
);

export const betterAuthOauthAccessToken = authProviderSchema.table(
  "better_auth_oauth_access_token",
  {
    id: text().primaryKey().notNull(),
    // Nullable: with a registered resource + signingAlgorithm, oauth-provider
    // issues a self-contained JWT access token and this row is bookkeeping
    // (for revocation/introspection), not the token's source of truth — the
    // hand-rolled server's own oauth_access_tokens table is documented as
    // similarly vestigial for the same reason.
    token: text(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOauthClient.clientId),
    sessionId: text("session_id").references(() => betterAuthSession.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => betterAuthUser.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text().array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(
      () => betterAuthOauthRefreshToken.id,
    ),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }),
    revoked: timestamp({ mode: "string" }),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (table) => [
    unique("better_auth_oauth_access_token_token_key").on(table.token),
  ],
);

export const betterAuthOauthConsent = authProviderSchema.table(
  "better_auth_oauth_consent",
  {
    id: text().primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOauthClient.clientId),
    userId: text("user_id").references(() => betterAuthUser.id),
    referenceId: text("reference_id"),
    resources: text().array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text().array().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }),
    updatedAt: timestamp("updated_at", { mode: "string" }),
  },
);

// Backs the private_key_jwt client-authentication method's replay
// protection (RFC 7523). Unused today — every client mapped from
// oauth_clients uses client_secret_basic or none (public/PKCE), never
// private_key_jwt — kept only because oauth-provider's core schema requires
// it unconditionally.
export const betterAuthOauthClientAssertion = authProviderSchema.table(
  "better_auth_oauth_client_assertion",
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  },
);
