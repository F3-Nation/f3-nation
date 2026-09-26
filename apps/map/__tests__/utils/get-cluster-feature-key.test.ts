import type { AnyProps, PointFeature } from "supercluster";
import Supercluster from "supercluster";
import { describe, expect, it } from "vitest";

import { getClusterFeatureKey } from "~/utils/get-cluster-feature-key";

const point = (
  id: number,
  lng: number,
  lat: number,
): PointFeature<AnyProps> => ({
  id,
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: {},
});

describe("getClusterFeatureKey", () => {
  it("prefixes cluster features with their cluster_id", () => {
    const feature = {
      ...point(13, -81, 35),
      properties: { cluster: true, cluster_id: 13, point_count: 5 },
    };
    expect(getClusterFeatureKey(feature)).toBe("cluster-13");
  });

  it("prefixes location features with their location id", () => {
    expect(getClusterFeatureKey(point(13, -122, 37))).toBe("location-13");
  });

  it("returns null for a location feature without an id", () => {
    const { id: _id, ...feature } = point(1, 0, 0);
    expect(getClusterFeatureKey(feature)).toBeNull();
  });

  it("keeps keys unique when a cluster id equals a location id", () => {
    const clusterer = new Supercluster({
      extent: 256,
      radius: 64,
      maxZoom: 12,
    });
    clusterer.load([
      point(7, -81.6746, 36.2168),
      point(8, -81.6854, 36.2117),
      point(9, -80.8431, 35.2271),
      point(11, -80.9301, 35.1852),
      point(13, -122.4194, 37.7749),
      point(16, -104.7894, 39.4338),
      point(18, -81.68, 36.214),
    ]);
    const features = clusterer.getClusters([-180, -85, 180, 85], 4);

    const rawIds = features.map((f) => f.id);
    expect(new Set(rawIds).size).toBeLessThan(rawIds.length);

    const keys = features.map(getClusterFeatureKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
