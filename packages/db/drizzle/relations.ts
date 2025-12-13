import { relations } from "drizzle-orm/relations";

import {
  achievements,
  achievementsXUsers,
  apiKeys,
  attendance,
  attendanceTypes,
  attendanceXAttendanceTypes,
  authAccounts,
  authSessions,
  eventInstances,
  eventInstancesXEventTypes,
  events,
  eventsXEventTypes,
  eventTags,
  eventTagsXEventInstances,
  eventTagsXEvents,
  eventTypes,
  expansions,
  expansionsXUsers,
  locations,
  orgs,
  orgsXSlackSpaces,
  permissions,
  positions,
  positionsXOrgsXUsers,
  roles,
  rolesXPermissions,
  rolesXUsersXOrg,
  slackSpaces,
  slackUsers,
  updateRequests,
  users,
} from "./schema";

export const eventInstancesRelations = relations(
  eventInstances,
  ({ one, many }) => ({
    location: one(locations, {
      fields: [eventInstances.locationId],
      references: [locations.id],
    }),
    org: one(orgs, {
      fields: [eventInstances.orgId],
      references: [orgs.id],
    }),
    event: one(events, {
      fields: [eventInstances.seriesId],
      references: [events.id],
    }),
    attendances: many(attendance),
    eventInstancesXEventTypes: many(eventInstancesXEventTypes),
    eventTagsXEventInstances: many(eventTagsXEventInstances),
  }),
);

export const locationsRelations = relations(locations, ({ one, many }) => ({
  eventInstances: many(eventInstances),
  org: one(orgs, {
    fields: [locations.orgId],
    references: [orgs.id],
  }),
  events: many(events),
  updateRequests: many(updateRequests),
}));

export const orgsRelations = relations(orgs, ({ one, many }) => ({
  eventInstances: many(eventInstances),
  locations: many(locations),
  eventTags: many(eventTags),
  users: many(users),
  achievements: many(achievements),
  eventTypes: many(eventTypes),
  org: one(orgs, {
    fields: [orgs.parentId],
    references: [orgs.id],
    relationName: "orgs_parentId_orgs_id",
  }),
  orgs: many(orgs, {
    relationName: "orgs_parentId_orgs_id",
  }),
  positions: many(positions),
  events: many(events),
  updateRequests: many(updateRequests),
  orgsXSlackSpaces: many(orgsXSlackSpaces),
  positionsXOrgsXUsers: many(positionsXOrgsXUsers),
  rolesXUsersXOrgs: many(rolesXUsersXOrg),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  eventInstances: many(eventInstances),
  location: one(locations, {
    fields: [events.locationId],
    references: [locations.id],
  }),
  org: one(orgs, {
    fields: [events.orgId],
    references: [orgs.id],
  }),
  event: one(events, {
    fields: [events.seriesId],
    references: [events.id],
    relationName: "events_seriesId_events_id",
  }),
  events: many(events, {
    relationName: "events_seriesId_events_id",
  }),
  updateRequests: many(updateRequests),
  eventTagsXEvents: many(eventTagsXEvents),
  eventsXEventTypes: many(eventsXEventTypes),
}));

export const attendanceRelations = relations(attendance, ({ one, many }) => ({
  eventInstance: one(eventInstances, {
    fields: [attendance.eventInstanceId],
    references: [eventInstances.id],
  }),
  user: one(users, {
    fields: [attendance.userId],
    references: [users.id],
  }),
  attendanceXAttendanceTypes: many(attendanceXAttendanceTypes),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  attendances: many(attendance),
  slackUsers: many(slackUsers),
  apiKeys: many(apiKeys),
  org: one(orgs, {
    fields: [users.homeRegionId],
    references: [orgs.id],
  }),
  authSessions: many(authSessions),
  achievementsXUsers: many(achievementsXUsers),
  positionsXOrgsXUsers: many(positionsXOrgsXUsers),
  rolesXUsersXOrgs: many(rolesXUsersXOrg),
  expansionsXUsers: many(expansionsXUsers),
  authAccounts: many(authAccounts),
}));

export const slackUsersRelations = relations(slackUsers, ({ one }) => ({
  user: one(users, {
    fields: [slackUsers.userId],
    references: [users.id],
  }),
}));

export const eventTagsRelations = relations(eventTags, ({ one, many }) => ({
  org: one(orgs, {
    fields: [eventTags.specificOrgId],
    references: [orgs.id],
  }),
  eventTagsXEventInstances: many(eventTagsXEventInstances),
  eventTagsXEvents: many(eventTagsXEvents),
}));

export const achievementsRelations = relations(
  achievements,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [achievements.specificOrgId],
      references: [orgs.id],
    }),
    achievementsXUsers: many(achievementsXUsers),
  }),
);

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
  org: one(orgs, {
    fields: [eventTypes.specificOrgId],
    references: [orgs.id],
  }),
  eventInstancesXEventTypes: many(eventInstancesXEventTypes),
  eventsXEventTypes: many(eventsXEventTypes),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  org: one(orgs, {
    fields: [positions.orgId],
    references: [orgs.id],
  }),
  positionsXOrgsXUsers: many(positionsXOrgsXUsers),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const updateRequestsRelations = relations(updateRequests, ({ one }) => ({
  event: one(events, {
    fields: [updateRequests.eventId],
    references: [events.id],
  }),
  location: one(locations, {
    fields: [updateRequests.locationId],
    references: [locations.id],
  }),
  org: one(orgs, {
    fields: [updateRequests.regionId],
    references: [orgs.id],
  }),
}));

export const eventInstancesXEventTypesRelations = relations(
  eventInstancesXEventTypes,
  ({ one }) => ({
    eventInstance: one(eventInstances, {
      fields: [eventInstancesXEventTypes.eventInstanceId],
      references: [eventInstances.id],
    }),
    eventType: one(eventTypes, {
      fields: [eventInstancesXEventTypes.eventTypeId],
      references: [eventTypes.id],
    }),
  }),
);

export const eventTagsXEventInstancesRelations = relations(
  eventTagsXEventInstances,
  ({ one }) => ({
    eventInstance: one(eventInstances, {
      fields: [eventTagsXEventInstances.eventInstanceId],
      references: [eventInstances.id],
    }),
    eventTag: one(eventTags, {
      fields: [eventTagsXEventInstances.eventTagId],
      references: [eventTags.id],
    }),
  }),
);

export const rolesXPermissionsRelations = relations(
  rolesXPermissions,
  ({ one }) => ({
    permission: one(permissions, {
      fields: [rolesXPermissions.permissionId],
      references: [permissions.id],
    }),
    role: one(roles, {
      fields: [rolesXPermissions.roleId],
      references: [roles.id],
    }),
  }),
);

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolesXPermissions: many(rolesXPermissions),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  rolesXPermissions: many(rolesXPermissions),
  rolesXUsersXOrgs: many(rolesXUsersXOrg),
}));

export const eventTagsXEventsRelations = relations(
  eventTagsXEvents,
  ({ one }) => ({
    event: one(events, {
      fields: [eventTagsXEvents.eventId],
      references: [events.id],
    }),
    eventTag: one(eventTags, {
      fields: [eventTagsXEvents.eventTagId],
      references: [eventTags.id],
    }),
  }),
);

export const eventsXEventTypesRelations = relations(
  eventsXEventTypes,
  ({ one }) => ({
    event: one(events, {
      fields: [eventsXEventTypes.eventId],
      references: [events.id],
    }),
    eventType: one(eventTypes, {
      fields: [eventsXEventTypes.eventTypeId],
      references: [eventTypes.id],
    }),
  }),
);

export const attendanceXAttendanceTypesRelations = relations(
  attendanceXAttendanceTypes,
  ({ one }) => ({
    attendance: one(attendance, {
      fields: [attendanceXAttendanceTypes.attendanceId],
      references: [attendance.id],
    }),
    attendanceType: one(attendanceTypes, {
      fields: [attendanceXAttendanceTypes.attendanceTypeId],
      references: [attendanceTypes.id],
    }),
  }),
);

export const attendanceTypesRelations = relations(
  attendanceTypes,
  ({ many }) => ({
    attendanceXAttendanceTypes: many(attendanceXAttendanceTypes),
  }),
);

export const orgsXSlackSpacesRelations = relations(
  orgsXSlackSpaces,
  ({ one }) => ({
    org: one(orgs, {
      fields: [orgsXSlackSpaces.orgId],
      references: [orgs.id],
    }),
    slackSpace: one(slackSpaces, {
      fields: [orgsXSlackSpaces.slackSpaceId],
      references: [slackSpaces.id],
    }),
  }),
);

export const slackSpacesRelations = relations(slackSpaces, ({ many }) => ({
  orgsXSlackSpaces: many(orgsXSlackSpaces),
}));

export const achievementsXUsersRelations = relations(
  achievementsXUsers,
  ({ one }) => ({
    achievement: one(achievements, {
      fields: [achievementsXUsers.achievementId],
      references: [achievements.id],
    }),
    user: one(users, {
      fields: [achievementsXUsers.userId],
      references: [users.id],
    }),
  }),
);

export const positionsXOrgsXUsersRelations = relations(
  positionsXOrgsXUsers,
  ({ one }) => ({
    org: one(orgs, {
      fields: [positionsXOrgsXUsers.orgId],
      references: [orgs.id],
    }),
    position: one(positions, {
      fields: [positionsXOrgsXUsers.positionId],
      references: [positions.id],
    }),
    user: one(users, {
      fields: [positionsXOrgsXUsers.userId],
      references: [users.id],
    }),
  }),
);

export const rolesXUsersXOrgRelations = relations(
  rolesXUsersXOrg,
  ({ one }) => ({
    org: one(orgs, {
      fields: [rolesXUsersXOrg.orgId],
      references: [orgs.id],
    }),
    role: one(roles, {
      fields: [rolesXUsersXOrg.roleId],
      references: [roles.id],
    }),
    user: one(users, {
      fields: [rolesXUsersXOrg.userId],
      references: [users.id],
    }),
  }),
);

export const expansionsXUsersRelations = relations(
  expansionsXUsers,
  ({ one }) => ({
    expansion: one(expansions, {
      fields: [expansionsXUsers.expansionId],
      references: [expansions.id],
    }),
    user: one(users, {
      fields: [expansionsXUsers.userId],
      references: [users.id],
    }),
  }),
);

export const expansionsRelations = relations(expansions, ({ many }) => ({
  expansionsXUsers: many(expansionsXUsers),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  owner: one(users, {
    fields: [apiKeys.ownerId],
    references: [users.id],
  }),
}));
