import kebabCase from "lodash/kebabCase";

/**
 * Pure shaping helpers for the public region pages (apps/region-pages).
 *
 * These were previously applied by the standalone f3-region-pages ingest job,
 * which copied orgs/events nightly into its own database. The pages now read
 * the live tables through `regionPages.*`, so the same transforms run at read
 * time instead.
 */

export interface RegionPageWorkoutRow {
  id: number;
  regionId: number;
  name: string;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  addressStreet: string | null;
  addressStreet2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  eventTypeNames: string[] | null;
}

export interface RegionPageWorkout {
  id: string;
  regionId: string;
  name: string;
  time: string;
  type: string;
  types: string[];
  group: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  location: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

export interface RegionOrgRow {
  id: number;
  name: string;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  email: string | null;
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
}

export interface RegionArea {
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  zoom: number;
}

export interface RegionPageRegion extends RegionArea {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  image: string | null;
  email: string | null;
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
  workoutCount: number;
}

/** Center of the contiguous US; used when a region has no mapped workouts. */
export const DEFAULT_REGION_CENTER = {
  latitude: 39.8283,
  longitude: -98.5795,
  zoom: 4,
} as const;

/**
 * The URL itself when it is http(s), else null. Region links are edited by
 * region admins and rendered as hrefs, so never pass other schemes through.
 */
export function httpUrlOrNull(url: string | null): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:" ? url.trim() : null;
  } catch {
    return null;
  }
}

/** URL slug for a region, unchanged from the legacy app so links keep working. */
export const regionSlug = (name: string): string => kebabCase(name);

export const normalizeEmail = (email: string | null): string | null =>
  email?.includes("@") ? email.trim() : null;

export function normalizeTwitterUrl(twitter: string | null): string | null {
  if (!twitter) return null;
  const match =
    /^(?:@|%40)?([a-zA-Z0-9_]+)\s*$|^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:#!\/)?@?([a-zA-Z0-9_]+)(?:\/?|\?.*|#.*)?\s*$/i.exec(
      twitter,
    );
  const handle = match?.[1] ?? match?.[2];
  return handle ? `https://x.com/${handle}` : null;
}

export function normalizeFacebookUrl(facebook: string | null): string | null {
  if (!facebook) return null;

  // Groups first: the profile pattern would otherwise read "groups" as a handle.
  const group =
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/groups\/([^/?]+)(?:\/|$|\?)/i.exec(
      facebook,
    );
  const groupName = group?.[1];
  if (groupName) {
    return /^[a-zA-Z0-9._-]+$/.test(groupName)
      ? `https://facebook.com/groups/${groupName}`
      : null;
  }

  const profile =
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([^/?]+)(?:\/|$|\?)/i.exec(
      facebook,
    );
  const handle = profile?.[1];
  if (!handle) return null;
  // Numeric-ID profile URLs only work in their original form.
  if (handle.startsWith("profile.php")) return httpUrlOrNull(facebook);
  return /^[a-zA-Z0-9._-]+$/.test(handle)
    ? `https://facebook.com/${handle}`
    : null;
}

export function normalizeInstagramUrl(instagram: string | null): string | null {
  if (!instagram) return null;
  const url =
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/i.exec(
      instagram,
    );
  if (url?.[1]) return `https://instagram.com/${url[1]}`;
  const handle = /^@?([a-zA-Z0-9._]+)$/.exec(instagram);
  if (handle?.[1]) return `https://instagram.com/${handle[1]}`;
  return null;
}

/** "0530" / "05:30" / "5:30" -> "5:30 AM"; anything else is returned as-is. */
export function formatClockTime(time: string): string {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(time.trim());
  if (!match?.[1] || !match[2]) return time;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return time;
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${match[2]} ${period}`;
}

export function formatTimeRange(
  startTime: string | null,
  endTime: string | null,
): string {
  if (startTime && endTime) {
    return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
  }
  const single = startTime ?? endTime;
  return single ? formatClockTime(single) : "";
}

const formatAddress = (row: RegionPageWorkoutRow): string =>
  [
    row.addressStreet,
    row.addressStreet2,
    row.addressCity,
    row.addressState,
    row.addressZip,
    row.addressCountry,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");

/**
 * Shape a query row as a workout. Returns null for rows the legacy ingest
 * skipped: no event type or no day of week.
 */
export function toRegionPageWorkout(
  row: RegionPageWorkoutRow,
): RegionPageWorkout | null {
  const types = (row.eventTypeNames ?? []).filter(Boolean);
  const [type] = types;
  if (!type || !row.dayOfWeek) return null;

  return {
    id: String(row.id),
    regionId: String(row.regionId),
    name: row.name,
    time: formatTimeRange(row.startTime, row.endTime),
    type,
    types,
    group: row.dayOfWeek,
    notes: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    location: formatAddress(row),
    city: row.addressCity,
    state: row.addressState,
    zip: row.addressZip,
    country: row.addressCountry,
  };
}

const scheduleKey = (workout: RegionPageWorkout): string =>
  JSON.stringify([
    workout.regionId,
    workout.name.trim(),
    workout.group,
    workout.time,
    workout.location,
  ]);

/**
 * Collapse workouts that share a schedule identity (region, name, day, time,
 * location), keeping the one with the highest event id. Mirrors the legacy
 * ingest's dedup so duplicate series don't render twice.
 */
export function dedupeWorkouts(
  workouts: RegionPageWorkout[],
): RegionPageWorkout[] {
  const byKey = new Map<string, RegionPageWorkout>();
  for (const workout of workouts) {
    const key = scheduleKey(workout);
    const existing = byKey.get(key);
    if (!existing || Number(workout.id) > Number(existing.id)) {
      byKey.set(key, workout);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id),
  );
}

/**
 * Where a region is, derived from its workouts: the address of the most common
 * zip code, and a map center/zoom that frames every mapped workout.
 */
export function summarizeRegionArea(workouts: RegionPageWorkout[]): RegionArea {
  const zipCounts = new Map<string, number>();
  for (const { zip } of workouts) {
    if (zip) zipCounts.set(zip, (zipCounts.get(zip) ?? 0) + 1);
  }
  let topZip: string | null = null;
  let topCount = 0;
  for (const [zip, count] of zipCounts) {
    if (count > topCount) {
      topZip = zip;
      topCount = count;
    }
  }
  const addressSource = topZip
    ? workouts.find((workout) => workout.zip === topZip)
    : undefined;

  const coords = workouts.filter(
    (w): w is RegionPageWorkout & { latitude: number; longitude: number } =>
      w.latitude != null && w.longitude != null,
  );

  const area = {
    city: addressSource?.city ?? null,
    state: addressSource?.state ?? null,
    zip: addressSource?.zip ?? null,
    country: addressSource?.country ?? null,
  };

  if (!coords.length) return { ...area, ...DEFAULT_REGION_CENTER };

  const lats = coords.map((w) => w.latitude);
  const lngs = coords.map((w) => w.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Pad the bounds ~20% per side so edge pins aren't flush with the frame.
  const latPadding = (maxLat - minLat) * 0.2;
  const lngPadding = (maxLng - minLng) * 0.2;
  const maxDiff = Math.max(
    maxLat - minLat + 2 * latPadding,
    maxLng - minLng + 2 * lngPadding,
  );
  // 111 km per degree; a single pin (maxDiff 0) clamps to the closest zoom.
  const zoom = Math.floor(15.5 - Math.log2(maxDiff * 111));

  return {
    ...area,
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    zoom: Math.min(Math.max(zoom, 4), 13),
  };
}

export function toRegionPageRegion(
  org: RegionOrgRow,
  workouts: RegionPageWorkout[],
): RegionPageRegion {
  return {
    id: String(org.id),
    name: org.name,
    slug: regionSlug(org.name),
    description: org.description,
    website: httpUrlOrNull(org.website),
    image: org.logoUrl,
    email: normalizeEmail(org.email),
    facebook: normalizeFacebookUrl(org.facebook),
    twitter: normalizeTwitterUrl(org.twitter),
    instagram: normalizeInstagramUrl(org.instagram),
    workoutCount: workouts.length,
    ...summarizeRegionArea(workouts),
  };
}
