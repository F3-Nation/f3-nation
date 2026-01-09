/**
 * Type definitions for the Slack bot
 */

/**
 * Region settings stored in SlackSpace.settings JSON column
 * Mirrors the Python SlackSettings dataclass
 */
export interface RegionSettings {
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
 */
export interface SlackUserData {
  id: number;
  slackId: string;
  userName: string;
  email: string;
  userId?: number;
  avatarUrl?: string;
  isAdmin: boolean;
  isBot: boolean;
}

/**
 * Request context passed to handlers
 */
export interface HandlerContext {
  teamId: string;
  userId: string;
  regionSettings?: RegionSettings;
  slackUser?: SlackUserData;
}
