import type { OrgType } from "@acme/shared/app/enums";

export type { OrgType };

export interface Point {
  lat: number;
  lng: number;
}

export interface Org {
  id: number;
  parentId: number | null;
  name: string;
  orgType: OrgType;
}

// Shape of one item returned by GET /v1/org-chart
export interface OrgChartItem {
  orgId: number;
  name: string | null;
  orgType: OrgType;
  /** Parent chain from immediate parent to root: [id, name, orgType] */
  hierarchy: [number, string | null, OrgType][];
  activeLocations: {
    latitude: number;
    longitude: number;
    eventCount: number;
    aoCount: number;
  }[];
}

export interface OrgDetail {
  id: number;
  name: string | null;
  orgType: OrgType;
  email: string | null;
  phone: string | null;
  website: string | null;
  twitter: string | null;
  facebook: string | null;
  instagram: string | null;
  positions: OrgLeaderEntry[];
  roles: OrgLeaderEntry[];
}

export interface OrgLeaderEntry {
  positionId?: number;
  roleId?: number;
  title: string;
  userId: number;
  f3Name: string | null;
  avatarUrl: string | null;
}

export interface OrgMetrics {
  events: number;
  aos: number;
  locations: number;
}
