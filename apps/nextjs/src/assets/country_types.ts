import type { Location } from "@acme/shared/app/types";

export interface Countries {
  type: string;
  bbox: number[];
  features: MapFeature[];
}

export type MapFeature = CountryFeature | StateFeature;
export interface CountryFeature {
  id?: string;
  type: string;
  bbox: number[];
  properties: CountryProperties;
  geometry: Geometry;
}

export interface StateFeature {
  id?: string;
  type: string;
  // bbox: number[]
  properties: {
    name: Location;
    density: number;
  };
  geometry: Geometry;
}

export const isCountryFeature = (
  e: MapFeature | null | undefined,
): e is CountryFeature => {
  return !!(e as CountryFeature | null)?.properties?.ISO_A3;
};

export const isStateFeature = (
  e: MapFeature | null | undefined,
): e is StateFeature => {
  return !!(e as StateFeature | null)?.properties?.name;
};

export interface CountryProperties {
  scalerank: number;
  featurecla: string;
  LABELRANK: number;
  SOVEREIGNT: string;
  SOV_A3: string;
  ADM0_DIF: number;
  LEVEL: number;
  TYPE: string;
  ADMIN: string;
  ADM0_A3: string;
  GEOU_DIF: number;
  GEOUNIT: string;
  GU_A3: string;
  SU_DIF: number;
  SUBUNIT: string;
  SU_A3: string;
  BRK_DIFF: number;
  NAME: string;
  NAME_LONG: string;
  BRK_A3: string;
  BRK_NAME: string;
  BRK_GROUP: unknown;
  ABBREV: string;
  POSTAL: string;
  FORMAL_EN: string | null;
  FORMAL_FR: unknown;
  NAME_CIAWF: string | null;
  NOTE_ADM0: unknown;
  NOTE_BRK: unknown;
  NAME_SORT: string;
  NAME_ALT: unknown;
  MAPCOLOR7: number;
  MAPCOLOR8: number;
  MAPCOLOR9: number;
  MAPCOLOR13: number;
  POP_EST: number;
  POP_RANK: number;
  GDP_MD_EST: number;
  POP_YEAR: number;
  LASTCENSUS: number;
  GDP_YEAR: number;
  ECONOMY: string;
  INCOME_GRP: string;
  WIKIPEDIA: number;
  FIPS_10_: string;
  ISO_A2: string;
  ISO_A3: Location;
  ISO_A3_EH: string;
  ISO_N3: string;
  UN_A3: string;
  WB_A2: string;
  WB_A3: string;
  WOE_ID: number;
  WOE_ID_EH: number;
  WOE_NOTE: string;
  ADM0_A3_IS: string;
  ADM0_A3_US: string;
  ADM0_A3_UN: number;
  ADM0_A3_WB: number;
  CONTINENT: string;
  REGION_UN: string;
  SUBREGION: string;
  REGION_WB: string;
  NAME_LEN: number;
  LONG_LEN: number;
  ABBREV_LEN: number;
  TINY: number;
  HOMEPART: number;
  MIN_ZOOM: number;
  MIN_LABEL: number;
  MAX_LABEL: number;
}

type Longitude = number;
type Latitude = number;
type LngLat = [Longitude, Latitude];
type LngLatRegion = LngLat[];

export interface Polygon {
  type: "Polygon";
  coordinates: LngLatRegion[];
}
export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: [LngLatRegion][];
}
export type Geometry = Polygon | MultiPolygon;

export const isPolygon = (e: Geometry): e is Polygon => {
  return e.type === "Polygon";
};

export const isMultiPolygon = (e: Geometry): e is MultiPolygon => {
  return e.type === "MultiPolygon";
};

export const getPolygonCenter = (
  polygon: Polygon,
): { lat: number; lng: number } => {
  const centerLng =
    (polygon.coordinates[0]?.reduce((acc, cur) => acc + cur[0], 0) ?? 0) /
    (polygon.coordinates[0]?.length ?? 1);
  const centerLat =
    (polygon.coordinates[0]?.reduce((acc, cur) => acc + cur[1], 0) ?? 0) /
    (polygon.coordinates[0]?.length ?? 1);
  return { lat: centerLat, lng: centerLng };
};

export const getMultiPolygonCenter = (
  multiPolygon: MultiPolygon,
): { lat: number; lng: number } => {
  const centerLng =
    (multiPolygon.coordinates[0]?.[0]?.reduce((acc, cur) => acc + cur[0], 0) ??
      0) / (multiPolygon.coordinates[0]?.[0]?.length ?? 1);
  const centerLat =
    (multiPolygon.coordinates[0]?.[0]?.reduce((acc, cur) => acc + cur[1], 0) ??
      0) / (multiPolygon.coordinates[0]?.[0]?.length ?? 1);
  return { lat: centerLat, lng: centerLng };
};

const _geometryPolygonTest: Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [61.210817, 35.650072],
      [64.546479, 36.312073],
      [61.210817, 35.650072],
    ],
    [
      [61.210817, 35.650072],
      [64.546479, 36.312073],
      [61.210817, 35.650072],
    ],
  ],
};

const _geometryMultiPolygonTest: Geometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [23.904154, -11.722282],
        [24.017894, -11.237298],
        [23.904154, -11.722282],
      ],
    ],
    [
      [
        [12.182337, -5.789931],
        [11.914963, -5.037987],
        [12.182337, -5.789931],
      ],
    ],
  ],
};
