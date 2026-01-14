/**
 * Slack Action IDs
 *
 * Constants for all action_id values used in Slack interactions.
 * Migrated from Python utilities/slack/actions.py
 */

export const ACTIONS = {
  // Loading and Debug
  LOADING: "loading",
  LOADING_ID: "loading_id",
  DEBUG_ID: "debug_id",
  DEBUG: "debug",

  // Navigation
  NAV_BACK: "nav-back",
  NAV_LOADING: "nav-loading",

  // Help
  CONFIG_HELP_MENU: "help_menu_config",
  CONFIG_HELP_MENU_CLOSE: "help-menu-close",

  // Welcome settings actions
  WELCOME_DM_ENABLE: "welcome-dm-enable",
  WELCOME_DM_TEMPLATE: "welcome-dm-template",
  WELCOME_CHANNEL_ENABLE: "welcome-channel-enable",
  WELCOME_CHANNEL: "welcome-channel",
  WELCOME_SAVE: "welcome-save",

  // Config actions
  CONFIG_CALLBACK_ID: "config-callback-id",
  CONFIG_EDITING_LOCKED: "config-editing-locked",
  CONFIG_DEFAULT_DESTINATION: "config-default-destination",
  CONFIG_DESTINATION_CHANNEL: "config-destination-channel",
  OPEN_WELCOME_CONFIG: "open-welcome-config",
  OPEN_GENERAL_CONFIG: "open-general-config",
  OPEN_CALENDAR_CONFIG: "open-calendar-config",
  CALENDAR_CONFIG_CALLBACK_ID: "calendar-config-id",
  CALENDAR_CONFIG_GENERAL: "calendar-config-general",
  CALENDAR_CONFIG_GENERAL_CALLBACK_ID: "calendar-config-general-id",

  // Calendar
  OPEN_CALENDAR_BUTTON: "open-calendar",
  OPEN_CALENDAR_MSG_BUTTON: "open-calendar-msg-button",
  CALENDAR_SHORTCUT: "calendar_shortcut",
  CALENDAR_HOME_EVENT: "calendar-home-event",
  CALENDAR_HOME_AO_FILTER: "calendar-home-ao-filter",
  CALENDAR_HOME_Q_FILTER: "calendar-home-q-filter",
  CALENDAR_HOME_DATE_FILTER: "calendar-home-date-filter",
  CALENDAR_HOME_EVENT_TYPE_FILTER: "calendar-home-type-filter",

  // Backblast
  BACKBLAST_CALLBACK_ID: "backblast-id",
  BACKBLAST_EDIT_CALLBACK_ID: "backblast-edit-id",
  BACKBLAST_NEW_BUTTON: "new-backblast",
  BACKBLAST_EDIT_BUTTON: "edit-backblast",
  BACKBLAST_STRAVA_BUTTON: "strava-button",
  BACKBLAST_SHORTCUT: "backblast_shortcut",
  BACKBLAST_FILL_SELECT: "backblast-fill-select",
  BACKBLAST_NEW_BLANK_BUTTON: "new-blank-backblast",
  MSG_EVENT_BACKBLAST_BUTTON: "event_backblast_button_dm",
  MSG_EVENT_BACKBLAST_ALREADY_BUTTON: "event_backblast_already_button_dm",

  // Preblast
  PREBLAST_CALLBACK_ID: "preblast-id",
  PREBLAST_EDIT_CALLBACK_ID: "preblast-edit-id",
  PREBLAST_NEW_BUTTON: "new-preblast",
  PREBLAST_EDIT_BUTTON: "edit-preblast",
  PREBLAST_SHORTCUT: "preblast_shortcut",
  EVENT_PREBLAST_CALLBACK_ID: "event-preblast-id",
  EVENT_PREBLAST_POST_CALLBACK_ID: "event-preblast-post-id",
  EVENT_PREBLAST_TAKE_Q: "event-preblast-take-q",
  EVENT_PREBLAST_REMOVE_Q: "event-preblast-remove-q",
  EVENT_PREBLAST_HC: "event-preblast-hc",
  EVENT_PREBLAST_UN_HC: "event-preblast-un-hc",
  EVENT_PREBLAST_EDIT: "event-preblast-edit",
  MSG_EVENT_PREBLAST_BUTTON: "event_preblast_button_dm",

  // Settings & Config
  SETTINGS_BUTTON: "settings_button",
  SETTINGS_SHORTCUT: "settings_shortcut",
  CONFIG_GENERAL: "general",
  CONFIG_GENERAL_CALLBACK_ID: "config-general-id",
  CONFIG_EMAIL: "email",
  CONFIG_EMAIL_CALLBACK_ID: "config-email-id",
  CONFIG_WELCOME_MESSAGE: "welcome_message",
  CONFIG_WEASELBOT: "config_weaselbot",
  CONFIG_CUSTOM_FIELDS: "custom_fields_submenu",
  CONFIG_CALENDAR: "calendar",
  CONFIG_SLT: "slt",
  CONFIG_CONNECT: "config_connect",
  CONFIG_REPORTING: "reporting",
  CONFIG_USER_SETTINGS: "user_settings",

  // Welcome
  WELCOME_MESSAGE_CONFIG_CALLBACK_ID: "welcome-message-config-id",

  // Strava
  STRAVA_CONNECT_BUTTON: "strava-connect",
  STRAVA_ACTIVITY_BUTTON: "strava-activity",
  STRAVA_MODIFY_CALLBACK_ID: "strava-modify-id",

  // Achievements
  ACHIEVEMENT_CALLBACK_ID: "achievement-id",
  TAG_ACHIEVEMENT_SHORTCUT: "tag_achievement_shortcut",

  // Region
  REGION_CALLBACK_ID: "region-id",
  REGION_INFO_BUTTON: "region_info",

  // Calendar Management
  CALENDAR_ADD_SERIES_AO: "calendar_add_series_ao",
  CALENDAR_MANAGE_LOCATIONS: "calendar-manage-locations",
  CALENDAR_MANAGE_AOS: "calendar-manage-aos",
  CALENDAR_MANAGE_SERIES: "calendar-manage-series",
  CALENDAR_MANAGE_EVENT_TYPES: "calendar-manage-event-types",
  CALENDAR_MANAGE_EVENT_TAGS: "calendar-manage-event-tags",
  CALENDAR_MANAGE_EVENT_INSTANCES: "calendar-manage-event-instances",
  CALENDAR_ADD_LOCATION_NAME: "calendar-add-location-name",
  CALENDAR_ADD_LOCATION_DESCRIPTION: "calendar-add-location-description",
  CALENDAR_ADD_LOCATION_LAT: "calendar-add-location-lat",
  CALENDAR_ADD_LOCATION_LON: "calendar-add-location-lon",
  CALENDAR_ADD_LOCATION_STREET: "calendar-add-location-street",
  CALENDAR_ADD_LOCATION_STREET2: "calendar-add-location-street2",
  CALENDAR_ADD_LOCATION_CITY: "calendar-add-location-city",
  CALENDAR_ADD_LOCATION_STATE: "calendar-add-location-state",
  CALENDAR_ADD_LOCATION_ZIP: "calendar-add-location-zip",
  CALENDAR_ADD_LOCATION_COUNTRY: "calendar-add-location-country",
  ADD_LOCATION_CALLBACK_ID: "add-location-id",
  EDIT_DELETE_LOCATION_CALLBACK_ID: "edit-delete-location-id",
  ADD_AO_CALLBACK_ID: "add-ao-id",
  EDIT_DELETE_AO_CALLBACK_ID: "edit-delete-ao-id",
  CALENDAR_ADD_AO_NAME: "calendar-add-ao-name",
  CALENDAR_ADD_AO_DESCRIPTION: "calendar-add-ao-description",
  CALENDAR_ADD_AO_CHANNEL: "calendar-add-ao-channel",
  CALENDAR_ADD_AO_LOCATION: "calendar-add-ao-location",
  CALENDAR_ADD_AO_LOGO: "calendar-add-ao-logo",
  ADD_SERIES_CALLBACK_ID: "add-series-id",
  SERIES_EDIT_DELETE: "series-edit-delete",
  LOCATION_EDIT_DELETE: "location-edit-delete",
  AO_EDIT_DELETE: "ao-edit-delete",

  // Admin
  DB_ADMIN_CALLBACK_ID: "db-admin-id",
  DB_ADMIN_UPGRADE: "db-admin-upgrade",
  DB_ADMIN_RESET: "db-admin-reset",

  // Q Lineup
  LINEUP_SIGNUP_BUTTON: "lineup-signup-button",
  HOME_ASSIGN_Q_CALLBACK_ID: "home-assign-q-id",
} as const;

export type ActionId = (typeof ACTIONS)[keyof typeof ACTIONS];
