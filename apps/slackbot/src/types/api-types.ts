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
