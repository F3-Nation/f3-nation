import { CLOSE_ZOOM, USER_LOCATION_ZOOM } from "@acme/shared/app/constants";
import { safeParseFloat } from "@acme/shared/common/functions";

// Google Maps zoom range
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

/**
 * Reads a `zoom` query param value. Returns undefined when it is missing or
 * not a finite number, and clamps it to the zoom levels Google Maps supports.
 */
export const parseZoomParam = (value: string | null): number | undefined => {
  const zoom = safeParseFloat(value);
  if (zoom === undefined || !Number.isFinite(zoom)) return undefined;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
};

/**
 * Zoom for the first jump to the visitor's location. A `zoom` query param
 * (e.g. from a site embed) wins; otherwise about a 25-30 mile radius.
 */
export const getUserLocationZoom = (search: string): number =>
  parseZoomParam(new URLSearchParams(search).get("zoom")) ?? USER_LOCATION_ZOOM;

/**
 * Zoom for the map's first render. A `zoom` param wins (0 included); a
 * location or lat/lon in the URL opens at street level; otherwise the stored
 * zoom.
 */
export const getInitialZoom = (params: {
  queryZoom: number | undefined;
  hasQueryLocation: boolean;
  storedZoom: number;
}): number =>
  params.queryZoom ??
  (params.hasQueryLocation ? CLOSE_ZOOM : params.storedZoom);
