import { USER_LOCATION_ZOOM } from "@acme/shared/app/constants";
import { safeParseFloat } from "@acme/shared/common/functions";

/**
 * Zoom for the first jump to the visitor's location. A `zoom` query param
 * (e.g. from a site embed) wins; otherwise about a 25-30 mile radius.
 */
export const getUserLocationZoom = (search: string) =>
  safeParseFloat(new URLSearchParams(search).get("zoom")) ?? USER_LOCATION_ZOOM;
