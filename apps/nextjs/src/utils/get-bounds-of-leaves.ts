import type { Feature, Point } from "geojson";

export const getBoundsOfLeaves = (leaves: Feature<Point>[]) => {
  const bounds = new google.maps.LatLngBounds();
  leaves.forEach((leaf) => {
    const [lng, lat] = leaf.geometry.coordinates;
    if (typeof lng !== "number" || typeof lat !== "number") return;
    bounds.extend({ lat, lng });
  });
  return bounds;
};
