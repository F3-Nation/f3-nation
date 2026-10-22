const EARTH_RADIUS_KM = 6371;

/**
 * Map center and zoom. Regions get theirs from the API (`region.latitude`,
 * `longitude`, `zoom`), which frames every workout pin.
 */
export interface MapParameters {
  center: { lat: number; lng: number };
  zoom: number;
}

/** Great-circle distance between two points, in kilometers. */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Link to the F3 Nation map at the given center and zoom. */
export function getMapUrl({ center, zoom }: MapParameters): string {
  return `https://map.f3nation.com/?lat=${center.lat}&lon=${center.lng}&zoom=${zoom}`;
}
