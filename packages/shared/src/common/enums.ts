export enum Header {
  Authorization = "authorization",
  Client = "client",
  ContentType = "Content-Type",
  Accept = "Accept",
  MobileVersion = "mobile_version",
  MobileBuild = "mobile_build",
  Source = "x-source",
}

export enum Case {
  LowerCase = "lowercase",
  CamelCase = "camelCase",
  PascalCase = "PascalCase",
  SnakeCase = "snake_case",
  KebabCase = "kebab-case",
  TitleCase = "Title Case",
  TrainCase = "TRAIN-CASE",
  ScreamingSnakeCase = "SCREAMING_SNAKE_CASE",
  SentenceCase = "Sentence case",
  UnknownCase = "Unknown case",
}

export enum ErrorMessage {
  EMAIL_REQUIRED = "Email is a required field",
  EMAIL_NOT_VERIFIED = "Please verify your email",
  EMAIL_EXISTS = "Email already exists. Use a different email address.",
  ERROR_WITH_ACCOUNT = "Error with account",
  FAILED_TO_DECODE_JWT = "Failed to decode JWT",
  INCORRECT_ROLE = "User does not have the correct role",
  NETWORK_REQUEST_FAILED = "Network request failed",
  NO_ID_FOUND = "No user found for this id",
  NO_INVITE_FOUND = "No matching invite found",
  NO_USER_FOUND = "No user found for this email",
  NOT_ADMIN = "isAdmin failed",
  NOT_AUTHENTICATED = "isAuthenticated failed",
  NOT_FOUND = "Record not found",
  PASSWORD_DOES_NOT_MATCH = "Password does not match",
  PASSWORD_LENGTH = "Password must be at least 8 characters",
  PASSWORD_REQUIRED = "Password is a required field",
  PASSWORD_DOES_NOT_EXIST = "User does not have a password",
  PASSWORDS_DO_NOT_MATCH = "Passwords do not match",
  REFRESH_FAILURE = "Unable to refresh access",
  REFRESH_TOKEN_NOT_FOUND = "Refresh token was not found",
  UNABLE_TO_DECODE_APPLE = "Unable to decode Apple JWT",
  UNABLE_TO_DECODE_GOOGLE = "Unable to decode Google JWT",
  UNABLE_TO_RESET_PASSWORD = "Unable to reset password",
  UNKNOWN_SIGN_IN_ERROR = "Unknown sign in error",
  UNKNOWN_SIGN_UP_ERROR = "Unknown sign up error",
  USER_EXISTS = "User already exists. Try logging in",
  // The case when a user tries to log into an account with
  // an email and password but the login attempt fails because
  // the user does not have a password stored in the database because
  // they either use oauth for login or their password was never set and
  // they must go through the reset password flow' = '',
  USER_PW_NOT_FOUND = "User password not found. Use Oauth or reset password",
  USER_USES_APPLE = "User uses Apple sign in",
  USER_USES_FACEBOOK = "User uses Facebook sign in",
  USER_USES_GOOGLE = "User uses Google sign in",
  SESSION_EXPIRED = "Session expired",
  INVALID_CSRF = "Invalid CSRF",
  INVALID_TOKEN = "Invalid token",
}

export enum ProviderId {
  EMAIL = "email",
  DEV_MODE = "dev-mode",
  OTP = "otp",
}

export enum TestId {
  MAP = "map",
  PANEL = "panel",
  NEARBY_LOCATIONS = "nearby-locations",
  GEOLOCATION_MARKER = "geolocation-marker",
  UPDATE_PANE_MARKER = "update-pane-marker",
  MAP_SEARCHBOX_INPUT = "map-searchbox-input",
  MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP = "map-searchbox-popover-content-desktop",
  SELECTED_ITEM_MOBILE = "selected-item-mobile",
  SELECTED_ITEM_DESKTOP = "selected-item-desktop",
  SECTOR_NATION_SELECT = "sector-nation-select",
  UPDATE_MODAL_SUBMIT_BUTTON = "update-modal-submit-button",
}

export enum Client {
  ORPC = "orpc",
  ORPC_SSG = "orpc-ssg",
  SCALAR_API = "scalar-api",
}
