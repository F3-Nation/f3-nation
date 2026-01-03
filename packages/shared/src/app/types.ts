import type { DefaultSession } from "next-auth";

import type { UserRole } from "./enums";

export interface WorkoutData {
  WorkoutName: string;
  "Day of week":
    | "Sunday"
    | "Monday"
    | "Tuesday"
    | "Wednesday"
    | "Thursday"
    | "Friday"
    | "Saturday";
  Time: string;
  Type: string;
  Notes: string;
  "Marker Icon": string;
  "Marker Color": string;
  "Icon Color": string;
  "Custom Size": string;
  Description: string;
}

// Group the
export interface GroupedMapData {
  id: string;
  Location: string;
  Latitude: number;
  Longitude: number;
  Image: string;
  Name: string;
  Region: string;
  Website: string;
  Groups: WorkoutData[];
}

type PlaceType = "street_address" | "geocode";

export interface PlaceResult {
  placePrediction: {
    place: string; //"places/ChIJvfn0MnyAhYARNjY8LxCHdyY",
    placeId: string; //"ChIJvfn0MnyAhYARNjY8LxCHdyY",
    text: {
      text: string; //"687 Folsom Street, San Francisco, CA, USA",
      matches: {
        endOffset: number;
      }[];
    };
    structuredFormat: {
      mainText: {
        text: string; //"687 Folsom Street",
        matches: {
          endOffset: number;
        }[];
      };
      secondaryText: {
        text: string; //"San Francisco, CA, USA";
      };
    };
    types: PlaceType[];
  };
}

export interface PlaceDetails {
  id: string;
  location: {
    latitude: number;
    longitude: number;
  };
  displayName: {
    text: string;
    languageCode: string;
  };
}

export interface GeoPluginResult {
  geoplugin_status: number; // 200;
  geoplugin_request: string; // "71.71.123.153";
  geoplugin_delay: string; // "1ms";
  geoplugin_credit: string; // "Some of the returned data includes GeoLite2 data created by MaxMind, available from <a href='https://www.maxmind.com'>https://www.maxmind.com</a>.";
  geoplugin_city: string; // "Elkin";
  geoplugin_region: string; // "North Carolina";
  geoplugin_regionCode: string; // "NC";
  geoplugin_regionName: string; // "North Carolina";
  geoplugin_areaCode: string; // "";
  geoplugin_dmaCode: string; // "518";
  geoplugin_countryCode: string; // "US";
  geoplugin_countryName: string; // "United States";
  geoplugin_inEU: number; // 0;
  geoplugin_euVATrate: boolean; //false;
  geoplugin_continentCode: string; // "NA";
  geoplugin_continentName: string; // "North America";
  geoplugin_latitude: string; // "36.2867";
  geoplugin_longitude: string; // "-80.86";
  geoplugin_locationAccuracyRadius: string; // "5";
  geoplugin_timezone: string; // "America/New_York";
  geoplugin_currencyCode: string; // "USD";
  geoplugin_currencySymbol: string; // "$";
  geoplugin_currencySymbol_UTF8: string; // "$";
  geoplugin_currencyConverter: number; // 0;
}

export const Location = {
  High_Country: "High_Country",
  Alabama: "Alabama",
  Alaska: "Alaska",
  Arizona: "Arizona",
  Arkansas: "Arkansas",
  California: "California",
  Colorado: "Colorado",
  Connecticut: "Connecticut",
  Delaware: "Delaware",
  District_of_Columbia: "District_of_Columbia",
  Florida: "Florida",
  Georgia: "Georgia",
  Hawaii: "Hawaii",
  Idaho: "Idaho",
  Illinois: "Illinois",
  Indiana: "Indiana",
  Iowa: "Iowa",
  Kansas: "Kansas",
  Kentucky: "Kentucky",
  Louisiana: "Louisiana",
  Maine: "Maine",
  Maryland: "Maryland",
  Massachusetts: "Massachusetts",
  Michigan: "Michigan",
  Minnesota: "Minnesota",
  Mississippi: "Mississippi",
  Missouri: "Missouri",
  Montana: "Montana",
  Nebraska: "Nebraska",
  Nevada: "Nevada",
  New_Hampshire: "New_Hampshire",
  New_Jersey: "New_Jersey",
  New_Mexico: "New_Mexico",
  New_York: "New_York",
  North_Carolina: "North_Carolina",
  North_Dakota: "North_Dakota",
  Ohio: "Ohio",
  Oklahoma: "Oklahoma",
  Oregon: "Oregon",
  Pennsylvania: "Pennsylvania",
  Rhode_Island: "Rhode_Island",
  South_Carolina: "South_Carolina",
  South_Dakota: "South_Dakota",
  Tennessee: "Tennessee",
  Texas: "Texas",
  Utah: "Utah",
  Vermont: "Vermont",
  Virginia: "Virginia",
  Washington: "Washington",
  West_Virginia: "West_Virginia",
  Wisconsin: "Wisconsin",
  Wyoming: "Wyoming",
  Puerto_Rico: "Puerto_Rico",
  AFG: "AFG",
  AGO: "AGO",
  ALB: "ALB",
  ARE: "ARE",
  ARG: "ARG",
  ARM: "ARM",
  ATA: "ATA",
  ATF: "ATF",
  AUS: "AUS",
  AUT: "AUT",
  AZE: "AZE",
  BDI: "BDI",
  BEL: "BEL",
  BEN: "BEN",
  BFA: "BFA",
  BGD: "BGD",
  BGR: "BGR",
  BHS: "BHS",
  BIH: "BIH",
  BLR: "BLR",
  BLZ: "BLZ",
  BOL: "BOL",
  BRA: "BRA",
  BRN: "BRN",
  BTN: "BTN",
  BWA: "BWA",
  CAF: "CAF",
  CAN: "CAN",
  CHE: "CHE",
  CHL: "CHL",
  CHN: "CHN",
  CIV: "CIV",
  CMR: "CMR",
  COD: "COD",
  COG: "COG",
  COL: "COL",
  CRI: "CRI",
  CUB: "CUB",
  CYP: "CYP",
  CZE: "CZE",
  DEU: "DEU",
  DJI: "DJI",
  DNK: "DNK",
  DOM: "DOM",
  DZA: "DZA",
  ECU: "ECU",
  EGY: "EGY",
  ERI: "ERI",
  ESP: "ESP",
  EST: "EST",
  ETH: "ETH",
  FIN: "FIN",
  FJI: "FJI",
  FLK: "FLK",
  FRA: "FRA",
  GAB: "GAB",
  GBR: "GBR",
  GEO: "GEO",
  GHA: "GHA",
  GIN: "GIN",
  GMB: "GMB",
  GNB: "GNB",
  GNQ: "GNQ",
  GRC: "GRC",
  GRL: "GRL",
  GTM: "GTM",
  GUY: "GUY",
  HND: "HND",
  HRV: "HRV",
  HTI: "HTI",
  HUN: "HUN",
  IDN: "IDN",
  IND: "IND",
  IRL: "IRL",
  IRN: "IRN",
  IRQ: "IRQ",
  ISL: "ISL",
  ISR: "ISR",
  ITA: "ITA",
  JAM: "JAM",
  JOR: "JOR",
  JPN: "JPN",
  KAZ: "KAZ",
  KEN: "KEN",
  KGZ: "KGZ",
  KHM: "KHM",
  KOR: "KOR",
  KOS: "KOS",
  KWT: "KWT",
  LAO: "LAO",
  LBN: "LBN",
  LBR: "LBR",
  LBY: "LBY",
  LKA: "LKA",
  LSO: "LSO",
  LTU: "LTU",
  LUX: "LUX",
  LVA: "LVA",
  MAR: "MAR",
  MDA: "MDA",
  MDG: "MDG",
  MEX: "MEX",
  MKD: "MKD",
  MLI: "MLI",
  MMR: "MMR",
  MNE: "MNE",
  MNG: "MNG",
  MOZ: "MOZ",
  MRT: "MRT",
  MWI: "MWI",
  MYS: "MYS",
  NAM: "NAM",
  NCL: "NCL",
  NER: "NER",
  NGA: "NGA",
  NIC: "NIC",
  NLD: "NLD",
  NOR: "NOR",
  NPL: "NPL",
  NZL: "NZL",
  OMN: "OMN",
  PAK: "PAK",
  PAN: "PAN",
  PER: "PER",
  PHL: "PHL",
  PNG: "PNG",
  POL: "POL",
  PRI: "PRI",
  PRK: "PRK",
  PRT: "PRT",
  PRY: "PRY",
  PSE: "PSE",
  QAT: "QAT",
  ROU: "ROU",
  RUS: "RUS",
  RWA: "RWA",
  ESH: "ESH",
  SAU: "SAU",
  SDN: "SDN",
  SSD: "SSD",
  SEN: "SEN",
  SLB: "SLB",
  SLE: "SLE",
  SLV: "SLV",
  SOL: "SOL",
  SOM: "SOM",
  SRB: "SRB",
  SUR: "SUR",
  SVK: "SVK",
  SVN: "SVN",
  SWE: "SWE",
  SWZ: "SWZ",
  SYR: "SYR",
  TCD: "TCD",
  TGO: "TGO",
  THA: "THA",
  TJK: "TJK",
  TKM: "TKM",
  TLS: "TLS",
  TTO: "TTO",
  TUN: "TUN",
  TUR: "TUR",
  TWN: "TWN",
  TZA: "TZA",
  UGA: "UGA",
  UKR: "UKR",
  URY: "URY",
  UZB: "UZB",
  VEN: "VEN",
  VNM: "VNM",
  VUT: "VUT",
  YEM: "YEM",
  ZAF: "ZAF",
  ZMB: "ZMB",
  ZWE: "ZWE",
};

export type Location = (typeof Location)[keyof typeof Location];

export const isDDD = (
  day: string,
): day is
  | "Sunday"
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday" => {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ].includes(day);
};

export type SlackUserMeta = Record<string, unknown>;

export type SlackSpacesMeta = Record<string, unknown>;

export type UserMeta = Record<string, unknown>;

export type EventMeta = {
  eventTypeId?: number;
  mapSeed?: boolean;
} & Record<string, unknown>;

export type LocationMeta = {
  latLonKey?: string;
  mapSeed?: boolean;
} & Record<string, unknown>;

export type OrgMeta = {
  latLonKey?: string;
  mapSeed?: boolean;
} & Record<string, unknown>;

export type UpdateRequestMeta = Record<string, unknown>;

export type AttendanceMeta = Record<string, unknown>;

export interface RoleEntry {
  orgId: number;
  roleName: "editor" | "admin";
}

export interface ApiKeyInfo {
  id: number;
  key: string;
  ownerId: number | null;
  revokedAt: string | null;
  expiresAt: string | null;
  orgIds: number[] | null;
}

export interface OrgRole {
  orgId: number;
  orgName: string;
  roleName: UserRole;
}

declare module "next-auth" {
  interface Session extends DefaultSession {
    id: number;
    email: string | undefined;
    roles?: OrgRole[];
    apiKey?: ApiKeyInfo;
  }
}
