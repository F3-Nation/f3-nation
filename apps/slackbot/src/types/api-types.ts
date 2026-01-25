import type { OrgSettings, OrgType, SlackUserData } from "./index";

export type { SlackUserData };

/**
 * Input for updating Slack space settings
 * Uses the field names from the API's SlackSettingsSchema validator
 */
export interface UpdateSpaceSettingsInput {
  welcome_dm_enable?: boolean;
  welcome_dm_template?: string;
  welcome_channel_enable?: boolean;
  welcome_channel?: string;
  editing_locked?: boolean;
  default_backblast_destination?: string;
  backblast_destination_channel?: string;
  default_preblast_destination?: string;
  preblast_destination_channel?: string;
  backblast_moleskin_template?: string;
  preblast_moleskin_template?: string;
  strava_enabled?: boolean;
  preblast_reminder_days?: number;
  backblast_reminder_days?: number;
  automated_preblast_option?: string;
  automated_preblast_hour_cst?: number;
}

/**
 * Input for upserting a Slack user
 */
export interface UpsertUserInput {
  slackId: string;
  userName: string;
  teamId: string;
  email?: string | null;
  userId?: number | null;
  isAdmin: boolean;
  isOwner: boolean;
  isBot: boolean;
}

/**
 * Response from checkUserRole endpoint
 */
export interface CheckUserRoleResponse {
  hasRole: boolean;
  reason:
    | "no-f3-user-linked"
    | "no-region-linked"
    | "role-not-found"
    | "direct-permission"
    | "ancestor-admin"
    | "no-permission";
  userId: number | null;
  orgId: number | null;
  roleName?: string;
}

/**
 * Single role entry from getUserRoles
 */
export interface UserRoleEntry {
  orgId: number;
  orgName: string | null;
  roleName: string | null;
}

/**
 * Response from getUserRoles endpoint
 */
export interface GetUserRolesResponse {
  roles: UserRoleEntry[];
  userId: number | null;
  regionOrgId: number | null;
  isAdmin?: boolean;
  isEditor?: boolean;
}

/**
 * Input for getOrCreateSpace endpoint
 */
export interface GetOrCreateSpaceInput {
  teamId: string;
  workspaceName?: string;
}

/**
 * Input for getOrCreateUser endpoint
 */
export interface GetOrCreateUserInput {
  slackId: string;
  teamId: string;
  userName: string;
  email?: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  isBot?: boolean;
  avatarUrl?: string;
}

/**
 * Input for getOrCreateLinkedUser endpoint.
 * Note: email is required to ensure F3 user can be created/linked.
 */
export interface GetOrCreateLinkedUserInput {
  slackId: string;
  teamId: string;
  userName: string;
  email: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  isBot?: boolean;
  avatarUrl?: string;
}

/**
 * Response from getOrCreateLinkedUser endpoint.
 * Always includes a userId linking to an F3 user.
 */
export interface LinkedSlackUserResponse {
  id: number;
  slackId: string;
  userName: string;
  email: string;
  /** Guaranteed to be present - the linked F3 user ID */
  userId: number;
  slackTeamId: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isBot: boolean;
}

/**
 * Response from getSpace endpoint
 */
export interface SlackSpaceResponse {
  id: number;
  teamId: string;
  workspaceName: string | null;
  botToken: string | null;
  settings: OrgSettings | null;
}

/**
 * Response from getOrg endpoint
 */
export interface OrgResponse {
  org: {
    id: number;
    name: string;
    orgType: OrgType;
    parentId: number | null;
  };
  space: SlackSpaceResponse;
}

/**
 * @deprecated Use OrgResponse instead
 * Response from getRegion endpoint
 */
export interface RegionResponse {
  org: { id: number; name: string; orgType: string };
  space: SlackSpaceResponse;
}

/**
 * Full user data including F3 user record if linked
 */
export type SlackUserResponse = SlackUserData & {
  user?: {
    id: number;
    f3Name: string | null;
    email: string;
  };
};

/**
 * Generic response for success/action operations
 */
export interface SuccessActionResponse {
  success: boolean;
  action: string;
}

/**
 * Location Response type
 */
export interface LocationResponse {
  id: number;
  locationName: string;
  regionId: number | null;
  regionName: string | null;
  description: string | null;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  email: string | null;
  addressStreet: string | null;
  addressStreet2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  meta: Record<string, unknown> | null;
  created: string;
}

/**
 * Location list response
 */
export interface LocationListResponse {
  locations: LocationResponse[];
  totalCount: number;
}

/**
 * Location input for creation/update
 */
export interface LocationInput {
  id?: number;
  name: string;
  orgId: number;
  description?: string | null;
  latitude: number;
  longitude: number;
  email?: string | null;
  addressStreet?: string | null;
  addressStreet2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  addressCountry?: string | null;
  isActive?: boolean;
  meta?: Record<string, unknown> | null;
}

/**
 * Event Instance Response type
 */
export interface EventInstanceResponse {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  locationId: number | null;
  orgId: number;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  highlight: boolean;
  meta: Record<string, unknown> | null;
  isPrivate: boolean;
  eventTypes?: { eventTypeId: number; eventTypeName: string }[];
  eventTags?: { eventTagId: number; eventTagName: string }[];
}

/**
 * Event Instance list response
 */
export interface EventInstanceListResponse {
  eventInstances: EventInstanceResponse[];
  totalCount: number;
}

/**
 * Event Instance input for creation/update
 */
export interface EventInstanceInput {
  id?: number;
  name?: string;
  description?: string | null;
  isActive?: boolean;
  locationId?: number | null;
  orgId?: number;
  startDate?: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  highlight?: boolean;
  meta?: Record<string, unknown> | null;
  isPrivate?: boolean;
  eventTypeId?: number;
  eventTagId?: number;
}
