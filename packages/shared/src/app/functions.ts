import { z } from "zod";

import type { DayOfWeek, RequestType } from "./enums";
import { MAX_PLACES_AUTOCOMPLETE_RADIUS } from "./constants";

export function zoomToRadius(zoom: number): number {
  // Clamp zoom between 4 and 20
  // Constants
  const EARTH_EQUATORIAL_RADIUS = 6378137; // in meters
  const TILE_SIZE = 256;

  // Calculate the ground resolution at the equator
  const groundResolution =
    (EARTH_EQUATORIAL_RADIUS * 2 * Math.PI) / (TILE_SIZE * Math.pow(2, zoom));

  // Calculate radius (assuming the visible area is 256x256 pixels)
  const radius = (groundResolution * TILE_SIZE) / 2;

  return Math.min(Math.max(radius, 0), MAX_PLACES_AUTOCOMPLETE_RADIUS);
}

export default function isWithinRadius({
  miles,
  basePosition,
  checkPosition,
}: {
  miles: number;
  basePosition: { lat: number; long: number };
  checkPosition: { lat: number; long: number };
}): boolean {
  const toRadians = (degree: number) => degree * (Math.PI / 180);
  const R = 3958.8; // Radius of the Earth in miles

  const dLat = toRadians(checkPosition.lat - basePosition.lat);
  const dLong = toRadians(checkPosition.long - basePosition.long);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(basePosition.lat)) *
      Math.cos(toRadians(checkPosition.lat)) *
      Math.sin(dLong / 2) *
      Math.sin(dLong / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance <= miles;
}

const isoDateRegExp = new RegExp(
  /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/,
);

// Could do this with a custom zod preprocess, but this may be simpler
// https://github.com/colinhacks/zod#preprocess
const isISODate = (str: string): boolean => {
  return isoDateRegExp.test(str);
};

export const dateOrIso = z.union([
  z.date(),
  z.string().refine(isISODate, { message: "Not a valid ISO string date " }),
]);

export const dayOfWeekToShortDayOfWeek = (dayOfWeek: DayOfWeek): string => {
  switch (dayOfWeek) {
    case "sunday":
      return "Su";
    case "monday":
      return "M";
    case "tuesday":
      return "Tu";
    case "wednesday":
      return "W";
    case "thursday":
      return "Th";
    case "friday":
      return "F";
    case "saturday":
      return "Sa";
    default:
      return "Su";
  }
};

export const getReadableDayOfWeek = (dayOfWeek: DayOfWeek | null) => {
  if (!dayOfWeek) {
    return null;
  }
  return dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
};

export const convertHH_mmToHHmm = (value: string) => {
  if (!value || value.length !== 5) {
    return "";
  }
  return value.replace(":", "");
};

export const convertHHmmToHH_mm = (value: string) => {
  if (!value || value.length !== 4) {
    return "";
  }
  return value.slice(0, 2) + ":" + value.slice(2, 4);
};

export const getFullAddress = (location: {
  locationAddress?: string | null;
  locationAddress2?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
}) => {
  return (
    [
      location.locationAddress,
      location.locationAddress2,
      location.locationCity,
      location.locationState,
      ["us", "usa", "unitedstates", "unitedstatesofamerica"].includes(
        location.locationCountry?.toLowerCase().replace(/(\.| )/g, "") ?? "",
      )
        ? ""
        : location.locationCountry,
    ]
      .filter(Boolean) // Remove empty/null/undefined values
      .join(", ")
      .replace(/, ,/g, ",") // Clean up any double commas
      .replace(/,\s*$/, "") || null
  ); // Remove trailing comma
};

export const requestTypeToTitle = (requestType: RequestType) => {
  switch (requestType) {
    case "create_event":
      return "New Workout";
    // case "create_location_and_event":
    //   return "New Location and Workout";

    case "edit":
      return "Edit Request";
    // case "edit_event":
    //   return "Edit Workout";
    // case "edit_ao_and_location":
    //   return "Edit AO and Location";

    // case "move_ao_to_different_region":
    //   return "Move AO to Different Region";
    // case "move_ao_to_new_location":
    //   return "Move AO to New Location";
    // case "move_ao_to_different_location":
    //   return "Move AO to Different Location";
    // case "move_event_to_different_ao":
    //   return "Move Workout to Different AO";
    // case "move_event_to_new_location":
    //   return "Move Workout to New Location";

    case "delete_event":
      return "Delete Workout";
    // case "delete_ao":
    //   return "Delete AO";
    default:
      return "Update";
  }
};

// Helper to normalize query params that can be single value or array
export const arrayOrSingle = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val]),
    z.array(schema),
  );

// Helper to parse sorting parameter from query string (can be JSON stringified)
export const parseSorting = () =>
  z.preprocess(
    (val) => {
      if (val === undefined || val === null) return undefined;
      console.log("val", val);
      // If it's an array of strings (happens when query params are split)
      // Try to join them and parse as JSON
      if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
        try {
          return JSON.parse(val.join(","));
        } catch {
          // If joining fails, try parsing each string individually
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return val.map((v: string) => JSON.parse(v));
          } catch {
            return undefined;
          }
        }
      }

      // If it's a string, parse it as JSON
      if (typeof val === "string") {
        console.log("val is string");
        try {
          return JSON.parse(val);
        } catch {
          return undefined;
        }
      }

      // If it's already an array or object, return as is
      return val;
    },
    z
      .array(
        z.object({
          id: z.string(),
          desc: z.boolean().optional().default(false),
        }),
      )
      .optional(),
  );

/**
 * @param email - Email string to validate
 * @returns boolean indicating if email is valid
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  return z.string().email().safeParse(trimmed).success;
}
