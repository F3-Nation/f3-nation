import type { FeatureCollection, Point } from "geojson";

import type { MarkerProperties } from "~/app/_components/marker-clusters/types";
import type { SparseF3Marker } from "~/utils/types";

export const getGeojson = (filteredLocationMarkers: SparseF3Marker[]) => {
  const geojson = filteredLocationMarkers.reduce(
    (acc, marker) => {
      if (typeof marker.lon !== "number" || typeof marker.lat !== "number") {
        return acc;
      }
      acc.features.push({
        id: marker.id,
        type: "Feature",
        geometry: { type: "Point", coordinates: [marker.lon, marker.lat] },
        properties: {
          name: marker.aoName,
          address: marker.fullAddress,
          logo: marker.logo,
        },
      });
      return acc;
    },
    { features: [], type: "FeatureCollection" } as FeatureCollection<
      Point,
      MarkerProperties
    >,
  ) ?? { features: [], type: "FeatureCollection" };
  return geojson;
};
