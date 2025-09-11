import type { FeatureCollection, Point } from "geojson";
import type { ClusterProperties } from "supercluster";

export interface F3ClusterProperties extends ClusterProperties {
  logos?: string;
}

export interface MarkersProps {
  geojson: FeatureCollection<Point, MarkerProperties>;
}

export interface MarkerProperties {
  name?: string | null;
  address?: string | null;
  logo?: string | null;
}
