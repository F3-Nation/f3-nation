import { eq, asc } from 'drizzle-orm';

import { db } from '../drizzle/db';
import {
  regions as regionsSchema,
  workouts as workoutsSchema,
} from '../drizzle/schema';

export async function enrichRegions() {
  console.debug('🔄 enriching regions...');
  const regions = await db
    .select()
    .from(regionsSchema)
    .orderBy(asc(regionsSchema.name));
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    console.debug(`enriching region ${i} of ${regions.length}: ${region.name}`);

    // Get all workouts for this region with coordinates
    const workouts = await db
      .select({
        city: workoutsSchema.city,
        state: workoutsSchema.state,
        zip: workoutsSchema.zip,
        country: workoutsSchema.country,
        latitude: workoutsSchema.latitude,
        longitude: workoutsSchema.longitude,
        name: workoutsSchema.name,
      })
      .from(workoutsSchema)
      .where(eq(workoutsSchema.regionId, region.id));

    // Calculate region location from most common zip code
    const regionPostalCodeCounts = workouts.reduce(
      (acc, workout) => {
        const zip = workout.zip;
        if (zip) {
          acc[zip] = (acc[zip] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const entries = Object.entries(regionPostalCodeCounts);
    let city = region.city;
    let state = region.state;
    let zip = region.zip;
    let country = region.country;

    if (entries.length > 0) {
      const mostCommonZip = entries.sort((a, b) => b[1] - a[1])[0][0];
      const workoutWithZip = workouts.find((w) => w.zip === mostCommonZip);
      if (workoutWithZip) {
        city = workoutWithZip.city;
        state = workoutWithZip.state;
        zip = workoutWithZip.zip;
        country = workoutWithZip.country;
      }
    }

    // Calculate map coordinates using the same formula as calculateMapParameters
    const workoutsWithCoords = workouts.filter(
      (workout) => workout.latitude != null && workout.longitude != null
    );

    let latitude = region.latitude;
    let longitude = region.longitude;
    let zoom = region.zoom;

    if (workoutsWithCoords.length > 0) {
      // Calculate bounds
      const lats = workoutsWithCoords.map((w) => w.latitude!);
      const lngs = workoutsWithCoords.map((w) => w.longitude!);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      // Add padding to the bounds (about 20% on each side)
      const latPadding = (maxLat - minLat) * 0.2;
      const lngPadding = (maxLng - minLng) * 0.2;
      const paddedMinLat = minLat - latPadding;
      const paddedMaxLat = maxLat + latPadding;
      const paddedMinLng = minLng - lngPadding;
      const paddedMaxLng = maxLng + lngPadding;

      // Calculate center using padded bounds
      latitude = (paddedMinLat + paddedMaxLat) / 2;
      longitude = (paddedMinLng + paddedMaxLng) / 2;

      // Calculate appropriate zoom level with adjusted formula
      const latDiff = paddedMaxLat - paddedMinLat;
      const lngDiff = paddedMaxLng - paddedMinLng;
      const maxDiff = Math.max(latDiff, lngDiff);

      // Adjust zoom calculation to be less aggressive
      // Start at zoom level 15 and subtract based on the size of the area
      zoom = Math.floor(15.5 - Math.log2(maxDiff * 111)); // 111km per degree at equator
      zoom = Math.min(Math.max(zoom, 4), 13); // Clamp between 4 and 13
    } else {
      // Default to central US location if no workouts with coordinates
      latitude = 39.8283;
      longitude = -98.5795;
      zoom = 4;
    }

    // Update the region with all calculated values
    await db
      .update(regionsSchema)
      .set({
        city,
        state,
        zip,
        country,
        latitude,
        longitude,
        zoom,
      })
      .where(eq(regionsSchema.id, region.id));
  }
  console.debug('✅ done enriching regions');
}

if (import.meta.main) {
  await enrichRegions();
}
