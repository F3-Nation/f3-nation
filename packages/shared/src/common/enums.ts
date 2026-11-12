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
  F3_ME = "f3-me",
  F3_REGION_PAGES = "f3-region-pages",
}
