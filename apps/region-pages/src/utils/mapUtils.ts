export const MAP_CONSTANTS = {
  EARTH_RADIUS_KM: 6371,
  ZOOM_LEVELS: {
    NEIGHBORHOOD: { distance: 5, zoom: 13 as number },
    SMALL_CITY: { distance: 15, zoom: 12 as number },
    LARGE_CITY: { distance: 30, zoom: 11 as number },
    METROPOLITAN: { distance: 60, zoom: 10 as number },
    REGIONAL: { distance: 100, zoom: 9 as number },
    WIDE_REGIONAL: { zoom: 8 as number },
  },
  DEFAULT_PARAMS: {
    lat: 0,
    lon: 0,
    zoom: 12,
  },
} as const;

export interface MapParameters {
  center: {
    lat: number;
    lng: number;
  };
  zoom: number;
  markers: Array<{
    lat: number;
    lng: number;
    title: string;
  }>;
}

/**
 * Calculates the haversine distance between two points on Earth
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return (
    2 *
    MAP_CONSTANTS.EARTH_RADIUS_KM *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

/**
 * Generates a URL for the F3 Nation map with the given parameters
 * @param params Object containing latitude, longitude, and zoom level
 * @returns URL string for the F3 Nation map
 */
export function getMapUrl(params: MapParameters): string {
  const { center, zoom } = params;
  const baseUrl = 'https://map.f3nation.com';

  // F3 Nation map uses a simple URL structure
  return `${baseUrl}/?lat=${center.lat}&lon=${center.lng}&zoom=${zoom}`;
}

/**
 * Calculates map parameters (center point and zoom level) based on workout locations
 * @param workouts Array of workout locations
 * @returns Object containing latitude, longitude, and zoom level
 */
export function calculateMapParameters(
  workouts: Array<{
    latitude?: number | null;
    longitude?: number | null;
    name: string;
  }>
): MapParameters {
  // Filter out workouts without coordinates
  const workoutsWithCoords = workouts.filter(
    (workout) => workout.latitude != null && workout.longitude != null
  );

  // Default to a central US location if no workouts with coordinates
  if (!workoutsWithCoords.length) {
    return {
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      markers: [],
    };
  }

  const markers = workoutsWithCoords.map((workout) => ({
    lat: workout.latitude!,
    lng: workout.longitude!,
    title: workout.name,
  }));

  // Calculate bounds
  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
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
  const center = {
    lat: (paddedMinLat + paddedMaxLat) / 2,
    lng: (paddedMinLng + paddedMaxLng) / 2,
  };

  // Calculate appropriate zoom level with adjusted formula
  const latDiff = paddedMaxLat - paddedMinLat;
  const lngDiff = paddedMaxLng - paddedMinLng;
  const maxDiff = Math.max(latDiff, lngDiff);

  // Adjust zoom calculation to be less aggressive
  // Start at zoom level 15 and subtract based on the size of the area
  const zoom = Math.floor(15.5 - Math.log2(maxDiff * 111)); // 111km per degree at equator

  return {
    center,
    zoom: Math.min(Math.max(zoom, 4), 13), // Clamp between 4 and 13
    markers,
  };
}
