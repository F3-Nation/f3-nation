import type { RegionSettings, SlackUserData } from "./index";

export type { SlackUserData };

/**
 * Input for updating Slack space settings
 */
export type UpdateSpaceSettingsInput = Partial<RegionSettings>;

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
 * Response from getSpace endpoint
 */
export interface SlackSpaceResponse {
  id: number;
  teamId: string;
  workspaceName: string | null;
  botToken: string | null;
  settings: RegionSettings | null;
}

/**
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
