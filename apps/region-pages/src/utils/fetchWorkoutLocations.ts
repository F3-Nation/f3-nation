/** @todo refactor lazy `as Region` type coercion */

import { unstable_cache } from 'next/cache';
import { WorkoutWithRegion } from '@/types/Workout';
import { Region } from '@/types/Region';
import { db } from '../../drizzle/db';
import { regions, workouts } from '../../drizzle/schema';
import { ALL_LETTERS, cacheTtl } from '@/lib/const';
import { eq, sql } from 'drizzle-orm';

// Generate a build-aware cache key to prevent cross-deployment cache pollution
const getBuildAwareCacheKey = (baseKey: string): string => {
  // Use build ID from Next.js or fallback to a timestamp-based approach
  const buildId =
    process.env.NEXT_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    Date.now().toString();
  return `${baseKey}-${buildId}`;
};

// Convert time to 12-hour format, handling various input formats
const convertTo12Hour = (time: string): string => {
  // Remove any existing AM/PM and extra spaces
  const cleanTime = time.replace(/\s*[AaPp][Mm]\s*/g, '').trim();

  try {
    const [hours, minutesPart] = cleanTime.split(':');
    if (!minutesPart) return time; // Return original if no minutes part

    const minutes = parseInt(minutesPart, 10);
    const hoursNum = parseInt(hours, 10);

    // Validate hours and minutes
    if (
      isNaN(hoursNum) ||
      isNaN(minutes) ||
      hoursNum < 0 ||
      hoursNum > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      console.warn(
        `Invalid time values (hours: ${hoursNum}, minutes: ${minutes}): "${time}"`
      );
      return time; // Return original if invalid
    }

    const period = hoursNum >= 12 ? 'PM' : 'AM';
    const hours12 = hoursNum % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  } catch (error) {
    console.warn(`Error parsing time: "${time}"`, error);
    return time; // Return original if parsing fails
  }
};

// Normalize time range to 12-hour format
const normalizeTimeRange = (timeRange: string): string => {
  // Handle various dash types (hyphen, en-dash, em-dash)
  const times = timeRange.split(/[-–—]/).map((t) => t.trim());
  return times.map(convertTo12Hour).join(' - ');
};

function normalizeRegionFields(region: Region): Region {
  return {
    id: String(region.id),
    name: region.name ? String(region.name) : '',
    description: region.description ? String(region.description) : '',
    slug: region.slug ? String(region.slug) : '',
    website: region.website ? String(region.website) : undefined,
    email: region.email ? String(region.email) : undefined,
    facebook: region.facebook ? String(region.facebook) : undefined,
    twitter: region.twitter ? String(region.twitter) : undefined,
    instagram: region.instagram ? String(region.instagram) : undefined,
    image: region.image ? String(region.image) : undefined,
    city: region.city ? String(region.city) : undefined,
    state: region.state ? String(region.state) : undefined,
    zip: region.zip ? String(region.zip) : undefined,
    country: region.country ? String(region.country) : undefined,
    latitude:
      region.latitude !== null && region.latitude !== undefined
        ? Number(region.latitude)
        : undefined,
    longitude:
      region.longitude !== null && region.longitude !== undefined
        ? Number(region.longitude)
        : undefined,
    zoom:
      region.zoom !== null && region.zoom !== undefined
        ? Number(region.zoom)
        : undefined,
  };
}

const getCachedRegions = unstable_cache(
  async (): Promise<Region[]> => {
    try {
      return (await db
        .select({
          id: regions.id,
          name: regions.name,
          description: regions.description,
          slug: regions.slug,
          website: regions.website,
          city: regions.city,
          state: regions.state,
          zip: regions.zip,
          country: regions.country,
          latitude: regions.latitude,
          longitude: regions.longitude,
          zoom: regions.zoom,
        })
        .from(regions)
        .orderBy(regions.name)) as Region[];
    } catch (error) {
      console.error('Error fetching regions:', error);
      return [];
    }
  },
  [getBuildAwareCacheKey('regions')],
  { revalidate: cacheTtl, tags: ['regions'] }
);

// Cache workouts for a specific region
const getCachedRegionWorkouts = unstable_cache(
  async (regionSlug: string): Promise<WorkoutWithRegion[]> => {
    try {
      const regionData = await db
        .select({
          id: regions.id,
          name: regions.name,
          description: regions.description,
          slug: regions.slug,
          website: regions.website,
          email: regions.email,
          facebook: regions.facebook,
          twitter: regions.twitter,
          instagram: regions.instagram,
          image: regions.image,
          city: regions.city,
          state: regions.state,
          zip: regions.zip,
          country: regions.country,
          latitude: regions.latitude,
          longitude: regions.longitude,
          zoom: regions.zoom,
        })
        .from(regions)
        .where(eq(regions.slug, regionSlug))
        .limit(1);

      if (!regionData || regionData.length === 0) {
        console.warn(`No region found for slug: ${regionSlug}`);
        return [];
      }

      const region = regionData[0];
      const regionWorkouts = await db
        .select({
          id: workouts.id,
          regionId: workouts.regionId,
          name: workouts.name,
          time: workouts.time,
          type: workouts.type,
          types: workouts.types,
          group: workouts.group,
          notes: workouts.notes,
          latitude: workouts.latitude,
          longitude: workouts.longitude,
          location: workouts.location,
        })
        .from(workouts)
        .where(eq(workouts.regionId, region.id))
        .orderBy(workouts.name);

      if (!regionWorkouts || regionWorkouts.length === 0) {
        console.warn(`No workouts found for region slug: ${regionSlug}`);
        return [
          {
            id: 'no-workouts',
            regionId: region.id,
            name: 'No workouts available',
            time: '',
            type: '',
            group: '',
            notes: undefined,
            latitude: region.latitude ?? undefined,
            longitude: region.longitude ?? undefined,
            location: `${region.city ?? ''}, ${region.state ?? ''}`.replace(
              /^, |, $/,
              ''
            ),
            region: region as Region,
          },
        ];
      }

      return regionWorkouts.map((workout) => {
        const normalizedTime = workout.time
          ? normalizeTimeRange(workout.time)
          : workout.time;
        const normalizedTypes = Array.isArray(workout.types)
          ? workout.types.filter(Boolean)
          : undefined;
        return {
          ...workout,
          time: normalizedTime,
          types: normalizedTypes,
          region,
        } as WorkoutWithRegion;
      });
    } catch (error) {
      console.error('Error fetching workouts for region:', error);
      return [];
    }
  },
  [getBuildAwareCacheKey('region-workouts')],
  { revalidate: cacheTtl, tags: ['region-workouts'] }
);

export const fetchRegions = async (): Promise<Region[]> => {
  const regionsRaw = await getCachedRegions();
  return regionsRaw.map(normalizeRegionFields) as Region[];
};

export const fetchRegionsByLetter = async (): Promise<
  Record<string, Omit<Region, 'id'>[]>
> => {
  const regionsRaw = await getCachedRegions();
  return ALL_LETTERS.reduce(
    (acc, letter) => {
      const filteredRegions =
        (regionsRaw
          .filter((region) =>
            (region.name || '').toLowerCase().startsWith(letter.toLowerCase())
          )
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(normalizeRegionFields) as Omit<Region, 'id'>[]) || [];
      acc[letter] = filteredRegions;
      return acc;
    },
    {} as Record<string, Omit<Region, 'id'>[]>
  );
};

export const fetchWorkoutLocationsByRegion = async (
  regionSlug: string
): Promise<WorkoutWithRegion[]> => await getCachedRegionWorkouts(regionSlug);

export const fetchRegionBySlug = async (
  regionSlug: string
): Promise<Region | null> => {
  const regionData = await db
    .select({
      id: regions.id,
      name: regions.name,
      description: regions.description,
      slug: regions.slug,
      website: regions.website,
      email: regions.email,
      facebook: regions.facebook,
      twitter: regions.twitter,
      instagram: regions.instagram,
      image: regions.image,
      city: regions.city,
      state: regions.state,
      zip: regions.zip,
      country: regions.country,
      latitude: regions.latitude,
      longitude: regions.longitude,
      zoom: regions.zoom,
    })
    .from(regions)
    .where(eq(regions.slug, regionSlug))
    .limit(1);
  if (!regionData[0]) return null;
  return normalizeRegionFields(regionData[0] as Region) as Region;
};

export const fetchRegionsWithWorkoutCounts = async (): Promise<
  (Region & { workoutCount: number })[]
> => {
  // Query regions with LEFT JOIN to get workout counts
  const results = (await db
    .select({
      id: regions.id,
      name: regions.name,
      description: regions.description,
      slug: regions.slug,
      website: regions.website,
      city: regions.city,
      state: regions.state,
      zip: regions.zip,
      country: regions.country,
      latitude: regions.latitude,
      longitude: regions.longitude,
      zoom: regions.zoom,
      workoutCount: sql<number>`count(${workouts.id})::int`,
    })
    .from(regions)
    .leftJoin(workouts, eq(regions.id, workouts.regionId))
    .groupBy(regions.id)
    .orderBy(regions.name)) as Region[];
  return results.map(normalizeRegionFields) as (Region & {
    workoutCount: number;
  })[];
};
