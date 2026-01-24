/**
 * Type definitions for the Slack bot
 */

/**
 * Org types in the F3 hierarchy (from lowest to highest)
 * AO -> Region -> Area -> Sector -> Nation
 */
export type OrgType = "ao" | "region" | "area" | "sector" | "nation";

/**
 * Org settings stored in SlackSpace.settings JSON column
 * Mirrors the Python SlackSettings dataclass.
 * Note: While historically called "RegionSettings", a SlackSpace can be
 * associated with any org type (commonly Region or Area).
 */
export interface OrgSettings {
  team_id: string;
  workspace_name?: string;

  // Welcome settings
  welcome_dm_enable?: boolean;
  welcome_dm_template?: string;
  welcome_channel_enable?: boolean;
  welcome_channel?: string;

  // Backblast settings
  default_destination?: string;
  destination_channel?: string;
  backblast_moleskine_template?: object;
  editing_locked?: boolean;
  enable_strava?: boolean;

  // Preblast settings
  default_preblast_destination?: string;
  preblast_destination_channel?: string;
  preblast_moleskine_template?: object;

  // Email settings
  email_enable?: boolean;
  email_server?: string;
  email_port?: number;
  email_from?: string;
  email_to?: string;
  email_password?: string;
  postie_enable?: boolean;

  // Calendar settings
  preblast_reminder_days?: number;
  backblast_reminder_days?: number;
  automated_preblast_time?: string;
  send_q_lineups?: boolean;
  send_q_lineups_method?: string | null;
  send_q_lineups_channel?: string | null;
  q_image_posting_enabled?: boolean;
  q_image_posting_channel?: string | null;
  send_q_lineups_day?: number | null;
  send_q_lineups_hour_cst?: number | null;

  // Weaselbot settings
  weaselbot_enable_features?: string[];
  achievement_channel?: string;
  kotter_channel?: string;
  kotter_weeks?: number;
  kotter_remove_weeks?: number;
  home_ao_weeks?: number;
  q_weeks?: number;
  q_posts?: number;

  // Custom fields
  custom_fields?: CustomField[];
}

export interface CustomField {
  name: string;
  type: "text" | "select" | "multi_select";
  options?: string[];
  enabled: boolean;
}

/**
 * Slack user data from the API
 * Note: isAdmin and isEditor are computed from the F3 role system,
 * NOT from Slack's workspace admin/owner flags.
 */
export interface SlackUserData {
  id: number;
  slackId: string;
  userName: string;
  email: string;
  /**
   * The F3 user ID linked to this Slack user.
   * This is always populated - if no existing F3 user exists for the email,
   * one will be created when the Slack user is first seen.
   */
  userId: number;
  avatarUrl?: string;
  /**
   * Whether the user is an admin for the F3 org (or any ancestor org).
   * This is checked against the F3 rolesXUsersXOrg table, not Slack permissions.
   */
  isAdmin: boolean;
  /**
   * Whether the user has editor (or admin) role for the F3 org.
   */
  isEditor: boolean;
  isBot: boolean;
}

/**
 * Request context passed to handlers
 */
export interface HandlerContext {
  teamId?: string;
  userId: string;
  orgSettings?: OrgSettings;
  slackUser?: SlackUserData;
}
