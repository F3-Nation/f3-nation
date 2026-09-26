import type { Feature, GeoJsonProperties, Point } from "geojson";

// Supercluster's generated cluster ids share a number space with location ids,
// so the two kinds of feature need distinct React keys.
export const getClusterFeatureKey = (
  feature: Feature<Point, GeoJsonProperties>,
): string | null => {
  const props = feature.properties;
  if (props?.cluster === true) return `cluster-${String(props.cluster_id)}`;
  return feature.id == null ? null : `location-${feature.id}`;
};
