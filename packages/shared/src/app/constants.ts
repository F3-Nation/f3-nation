import { z } from "zod";

export enum SnapPoint {
  "pt-0.95" = 0.95,
  // "pt-0.5" = 0.5,
  "pt-150px" = "150px",
}

export const DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const SHORT_DAY_ORDER = ["Su", "M", "Tu", "W", "Th", "F", "Sa"] as const;

export const DEFAULT_ZOOM = 2.9;
export const BOONE_CENTER = [36.211104, -81.660849] as [number, number];
export const DEFAULT_CENTER = BOONE_CENTER;

export const CLOSE_ZOOM = 13;
export const FAR_ZOOM = 4;
export const COUNTRY_ZOOM = 5; // below 5 it is red

export enum BreakPoints {
  MD = 640,
  LG = 1024,
}

export const HEADER_HEIGHT = 96;
export const SIDEBAR_WIDTH = 360;

export const ADMIN_SIDEBAR_WIDTH = 240;
export const ADMIN_HEADER_HEIGHT = 64;

export const MAX_DESKTOP_WORKOUT_PANEL_WIDTH = 448; // must match to MD

export const MAX_PLACES_AUTOCOMPLETE_RADIUS = 50000;

export const SELECTED_ITEM_DEBOUNCE_TIME_MS = 100;

export const Z_INDEX = {
  NAVIGATION_MENU: 1,

  NAVIGATION_MENU_ROOT: 10,

  CALENDAR_CELL: 20,

  SHEET_OVERLAY: 50,
  SHEET_VARIANTS: 50,
  HOVER_CARD_CONTENT: 50,
  DRAWER_OVERLAY: 50,
  DRAWER_CONTENT: 50,
  DIALOG_CONTENT_CONTAINER: 50,
  ALERT_DIALOG_OVERLAY: 50,
  CONTEXT_MENU_CONTENT: 50,
  CONTEXT_MENU_SUBCONTENT: 50,
  ALERT_DIALOG: 50,

  DIALOG_CONTENT: 51,

  MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP: 1000,
  MOBILE_FILTER_BUTTONS: 1000,
  PLACE_RESULTS_ICON_PANE: 1000,
  MOBILE_NEARBY_LOCATIONS: 1000,
  DEBUG_INFO: 1000,
  CENTER_POINT_MARKER_PANE: 1000,
  NON_HOVERED_MAP_MARKER: 1000,
  ZOOM_AND_TILE_BUTTONS: 1000,
  OVERLAY_BUTTONS: 1001,

  ZOOMED_MARKER_PANE: 1001,
  F3_LOGO: 1001,
  PANEL_ITEM_MARKER: 1001,
  GEOLOCATION_MARKER: 1002,
  SELECTED_MARKER: 1002,

  SELECTED_ICON_MARKER_PANE: 1102,
  PANEL_ITEM_MARKER_PANE: 1103,
  LOCATION_PANEL: 1104,
  SELECTED_ITEM_CONTAINER_DESKTOP: 1105,
  MOBILE_SEARCH_RESULTS: 1106,

  MAP_SEARCHBOX_MOBILE: 1107,

  DIALOG_OVERLAY: 1201,
  USER_LOCATION_ICON: 1201,
  USER_LOCATION_INFO_MODAL: 1201,
  WORKOUT_DETAILS_MODAL: 1201,
  HOW_TO_JOIN_MODAL: 1201,

  MOBILE_ALL_FILTERS_CONTAINER: 2001,

  DROPDOWN_MENU_SUBCONTENT: 2002,
  DROPDOWN_MENU_CONTENT: 2002,
  SELECT_CONTENT: 2002,
  POPOVER_CONTENT: 2003,

  // Needs to be above the selected item
  UPDATE_PANE: 2004,

  TOOLTIP_CONTENT: 9000,

  // Default station button
  HOVER_CARD: 9000,
} as const;

export const MOBILE_SEARCH_RESULT_ITEM_HEIGHT = 128;

export const MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS = 2;

export const feedbackSchema = z.object({
  type: z.enum(["bug", "feature request", "feedback", "other"]),
  subject: z.string(),
  email: z.string(),
  description: z.string(),
});

export type FeedbackSchema = z.infer<typeof feedbackSchema>;

export const filterButtonClassName =
  "text-sm w-full whitespace-nowrap font-semibold pointer-events-auto flex items-center justify-center gap-2 rounded-md bg-card px-2 py-1 shadow text-foreground";

// Basic is just signed in
// Editor can change data for their region
// Admin can change anything
type AuthType = "none" | "admin" | "basic" | "editor";

interface RouteBase {
  __path: string;
  __auth: AuthType;
}

type Route = RouteBase & {
  [K: string]: Route | string;
};

type Routes = Record<string, Route>;

export const routes = {
  index: {
    __path: "/",
    __auth: "none",
  },
  admin: {
    __path: "/admin",
    __auth: "editor",
    regions: {
      __path: "/admin/regions",
      __auth: "editor",
    },
    theNation: {
      __path: "/admin/the-nation",
      __auth: "editor",
    },
    sectors: {
      __path: "/admin/sectors",
      __auth: "editor",
    },
    areas: {
      __path: "/admin/areas",
      __auth: "editor",
    },
    aos: {
      __path: "/admin/aos",
      __auth: "editor",
    },
    users: {
      __path: "/admin/users",
      __auth: "editor",
    },
    requests: {
      __path: "/admin/requests",
      __auth: "editor",
    },
    apiKeys: {
      __path: "/admin/api-keys",
      __auth: "admin",
    },
    locations: {
      __path: "/admin/locations",
      __auth: "editor",
    },
    eventTypes: {
      __path: "/admin/event-types",
      __auth: "editor",
    },
    workouts: {
      __path: "/admin/workouts",
      __auth: "editor",
    },
    noAccess: {
      __path: "/no-access",
      __auth: "none",
    },
  },
  auth: {
    __path: "/api/auth",
    __auth: "none",
    signIn: {
      __path: "/api/auth/signin",
      __auth: "none",
    },
    signOut: {
      __path: "/api/auth/signout",
      __auth: "none",
    },
    callback: {
      __path: "/api/auth/callback",
      __auth: "none",
    },
  },
} as const;

export const getAuthRoutes = (routes: Routes, auth: AuthType): string[] => {
  const authPaths: string[] = [];

  const traverse = (obj: RouteBase | Routes, _parentKey = "") => {
    if (
      "__path" in obj &&
      typeof obj.__path === "string" &&
      obj.__auth === auth
    ) {
      authPaths.push(obj.__path);
    }

    for (const [key, value] of Object.entries(obj as Record<string, Route>)) {
      if (!["__path", "__auth"].includes(key)) {
        traverse(value, key);
      }
    }
  };

  traverse(routes);
  return authPaths;
};

export const ADMIN_PATHS = getAuthRoutes(routes, "admin");
export const EDITOR_PATHS = getAuthRoutes(routes, "editor");

export enum AppType {
  MOBILE = "expo-react",
  WEB = "nextjs-react",
  RSC = "rsc",
  UNKNOWN = "unknown",
}

export enum Permissions {
  ADMIN = "admin",
  EDIT = "edit",
}

export const START_END_TIME_DB_FORMAT = "HHmm" as const;
export const START_END_TIME_DISPLAY_FORMAT = "h:mmA" as const;

export const COUNTRIES = [
  { name: "Afghanistan", code: "AF" },
  { name: "Albania", code: "AL" },
  { name: "Algeria", code: "DZ" },
  { name: "Andorra", code: "AD" },
  { name: "Angola", code: "AO" },
  { name: "Antigua and Barbuda", code: "AG" },
  { name: "Argentina", code: "AR" },
  { name: "Armenia", code: "AM" },
  { name: "Australia", code: "AU" },
  { name: "Austria", code: "AT" },
  { name: "Azerbaijan", code: "AZ" },
  { name: "Bahamas", code: "BS" },
  { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" },
  { name: "Barbados", code: "BB" },
  { name: "Belarus", code: "BY" },
  { name: "Belgium", code: "BE" },
  { name: "Belize", code: "BZ" },
  { name: "Benin", code: "BJ" },
  { name: "Bhutan", code: "BT" },
  { name: "Bolivia", code: "BO" },
  { name: "Bosnia and Herzegovina", code: "BA" },
  { name: "Botswana", code: "BW" },
  { name: "Brazil", code: "BR" },
  { name: "Brunei", code: "BN" },
  { name: "Bulgaria", code: "BG" },
  { name: "Burkina Faso", code: "BF" },
  { name: "Burundi", code: "BI" },
  { name: "Cabo Verde", code: "CV" },
  { name: "Cambodia", code: "KH" },
  { name: "Cameroon", code: "CM" },
  { name: "Canada", code: "CA" },
  { name: "Central African Republic", code: "CF" },
  { name: "Chad", code: "TD" },
  { name: "Chile", code: "CL" },
  { name: "China", code: "CN" },
  { name: "Colombia", code: "CO" },
  { name: "Comoros", code: "KM" },
  { name: "Congo", code: "CG" },
  { name: "Costa Rica", code: "CR" },
  { name: "Croatia", code: "HR" },
  { name: "Cuba", code: "CU" },
  { name: "Cyprus", code: "CY" },
  { name: "Czech Republic", code: "CZ" },
  { name: "Denmark", code: "DK" },
  { name: "Djibouti", code: "DJ" },
  { name: "Dominica", code: "DM" },
  { name: "Dominican Republic", code: "DO" },
  { name: "Ecuador", code: "EC" },
  { name: "Egypt", code: "EG" },
  { name: "El Salvador", code: "SV" },
  { name: "Equatorial Guinea", code: "GQ" },
  { name: "Eritrea", code: "ER" },
  { name: "Estonia", code: "EE" },
  { name: "Eswatini", code: "SZ" },
  { name: "Ethiopia", code: "ET" },
  { name: "Fiji", code: "FJ" },
  { name: "Finland", code: "FI" },
  { name: "France", code: "FR" },
  { name: "Gabon", code: "GA" },
  { name: "Gambia", code: "GM" },
  { name: "Georgia", code: "GE" },
  { name: "Germany", code: "DE" },
  { name: "Ghana", code: "GH" },
  { name: "Greece", code: "GR" },
  { name: "Grenada", code: "GD" },
  { name: "Guatemala", code: "GT" },
  { name: "Guinea", code: "GN" },
  { name: "Guinea-Bissau", code: "GW" },
  { name: "Guyana", code: "GY" },
  { name: "Haiti", code: "HT" },
  { name: "Honduras", code: "HN" },
  { name: "Hungary", code: "HU" },
  { name: "Iceland", code: "IS" },
  { name: "India", code: "IN" },
  { name: "Indonesia", code: "ID" },
  { name: "Iran", code: "IR" },
  { name: "Iraq", code: "IQ" },
  { name: "Ireland", code: "IE" },
  { name: "Israel", code: "IL" },
  { name: "Italy", code: "IT" },
  { name: "Jamaica", code: "JM" },
  { name: "Japan", code: "JP" },
  { name: "Jordan", code: "JO" },
  { name: "Kazakhstan", code: "KZ" },
  { name: "Kenya", code: "KE" },
  { name: "Kiribati", code: "KI" },
  { name: "Korea, North", code: "KP" },
  { name: "Korea, South", code: "KR" },
  { name: "Kosovo", code: "XK" },
  { name: "Kuwait", code: "KW" },
  { name: "Kyrgyzstan", code: "KG" },
  { name: "Laos", code: "LA" },
  { name: "Latvia", code: "LV" },
  { name: "Lebanon", code: "LB" },
  { name: "Lesotho", code: "LS" },
  { name: "Liberia", code: "LR" },
  { name: "Libya", code: "LY" },
  { name: "Liechtenstein", code: "LI" },
  { name: "Lithuania", code: "LT" },
  { name: "Luxembourg", code: "LU" },
  { name: "Madagascar", code: "MG" },
  { name: "Malawi", code: "MW" },
  { name: "Malaysia", code: "MY" },
  { name: "Maldives", code: "MV" },
  { name: "Mali", code: "ML" },
  { name: "Malta", code: "MT" },
  { name: "Marshall Islands", code: "MH" },
  { name: "Mauritania", code: "MR" },
  { name: "Mauritius", code: "MU" },
  { name: "Mexico", code: "MX" },
  { name: "Micronesia", code: "FM" },
  { name: "Moldova", code: "MD" },
  { name: "Monaco", code: "MC" },
  { name: "Mongolia", code: "MN" },
  { name: "Montenegro", code: "ME" },
  { name: "Morocco", code: "MA" },
  { name: "Mozambique", code: "MZ" },
  { name: "Myanmar", code: "MM" },
  { name: "Namibia", code: "NA" },
  { name: "Nauru", code: "NR" },
  { name: "Nepal", code: "NP" },
  { name: "Netherlands", code: "NL" },
  { name: "New Zealand", code: "NZ" },
  { name: "Nicaragua", code: "NI" },
  { name: "Niger", code: "NE" },
  { name: "Nigeria", code: "NG" },
  { name: "North Macedonia", code: "MK" },
  { name: "Norway", code: "NO" },
  { name: "Oman", code: "OM" },
  { name: "Pakistan", code: "PK" },
  { name: "Palau", code: "PW" },
  { name: "Palestine", code: "PS" },
  { name: "Panama", code: "PA" },
  { name: "Papua New Guinea", code: "PG" },
  { name: "Paraguay", code: "PY" },
  { name: "Peru", code: "PE" },
  { name: "Philippines", code: "PH" },
  { name: "Poland", code: "PL" },
  { name: "Portugal", code: "PT" },
  { name: "Qatar", code: "QA" },
  { name: "Romania", code: "RO" },
  { name: "Russia", code: "RU" },
  { name: "Rwanda", code: "RW" },
  { name: "Saint Kitts and Nevis", code: "KN" },
  { name: "Saint Lucia", code: "LC" },
  { name: "Saint Vincent and the Grenadines", code: "VC" },
  { name: "Samoa", code: "WS" },
  { name: "San Marino", code: "SM" },
  { name: "Sao Tome and Principe", code: "ST" },
  { name: "Saudi Arabia", code: "SA" },
  { name: "Senegal", code: "SN" },
  { name: "Serbia", code: "RS" },
  { name: "Seychelles", code: "SC" },
  { name: "Sierra Leone", code: "SL" },
  { name: "Singapore", code: "SG" },
  { name: "Slovakia", code: "SK" },
  { name: "Slovenia", code: "SI" },
  { name: "Solomon Islands", code: "SB" },
  { name: "Somalia", code: "SO" },
  { name: "South Africa", code: "ZA" },
  { name: "South Sudan", code: "SS" },
  { name: "Spain", code: "ES" },
  { name: "Sri Lanka", code: "LK" },
  { name: "Sudan", code: "SD" },
  { name: "Suriname", code: "SR" },
  { name: "Sweden", code: "SE" },
  { name: "Switzerland", code: "CH" },
  { name: "Syria", code: "SY" },
  { name: "Taiwan", code: "TW" },
  { name: "Tajikistan", code: "TJ" },
  { name: "Tanzania", code: "TZ" },
  { name: "Thailand", code: "TH" },
  { name: "Timor-Leste", code: "TL" },
  { name: "Togo", code: "TG" },
  { name: "Tonga", code: "TO" },
  { name: "Trinidad and Tobago", code: "TT" },
  { name: "Tunisia", code: "TN" },
  { name: "Turkey", code: "TR" },
  { name: "Turkmenistan", code: "TM" },
  { name: "Tuvalu", code: "TV" },
  { name: "Uganda", code: "UG" },
  { name: "Ukraine", code: "UA" },
  { name: "United Arab Emirates", code: "AE" },
  { name: "United Kingdom", code: "GB" },
  { name: "United States", code: "US" },
  { name: "Uruguay", code: "UY" },
  { name: "Uzbekistan", code: "UZ" },
  { name: "Vanuatu", code: "VU" },
  { name: "Vatican City", code: "VA" },
  { name: "Venezuela", code: "VE" },
  { name: "Vietnam", code: "VN" },
  { name: "Yemen", code: "YE" },
  { name: "Zambia", code: "ZM" },
  { name: "Zimbabwe", code: "ZW" },
];

export const TEST_NATION_ORG_ID = 1;
export const TEST_REGION_1_ORG_ID = 2;
export const TEST_REGION_2_ORG_ID = 3;
export const TEST_REGION_3_ORG_ID = 4;
export const TEST_SECTOR_ORG_ID = 5;
export const TEST_AREA_ORG_ID = 6;
export const TEST_AO_1_ORG_ID = 7;
export const TEST_AO_2_ORG_ID = 8;
export const TEST_EDITOR_USER_ID = 1;
export const TEST_ADMIN_USER_ID = 2;
export const TEST_EDITOR_ROLE_ID = 1;
export const TEST_ADMIN_ROLE_ID = 2;

export const API_PREFIX_V1 = "/v1" as const;
export const MAP_API_PREFIX = "/map" as const;

export enum ApiKeyTags {
  API = "api",
  API_KEY = "api-key",
  AUTH = "auth",
  EVENT = "event",
  EVENT_TYPE = "event-type",
  FEEDBACK = "feedback",
  LOCATION = "location",
  ORG = "org",
  PING = "ping",
  REQUEST = "request",
  USER = "user",
}
