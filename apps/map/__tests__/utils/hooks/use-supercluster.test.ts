import type { FeatureCollection, Point } from "geojson";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSupercluster } from "~/utils/hooks/use-supercluster";

vi.mock("~/utils/hooks/use-map-viewport", () => ({
  useMapViewport: () => ({ bbox: [-180, -85, 180, 85], zoom: 4 }),
}));

const geojson: FeatureCollection<Point, Record<string, unknown>> = {
  type: "FeatureCollection",
  features: [
    [7, -81.6746, 36.2168],
    [9, -80.8431, 35.2271],
    [13, -122.4194, 37.7749],
  ].map(([id, lng, lat]) => ({
    id,
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] as [number, number] },
    properties: {},
  })),
};

describe("useSupercluster", () => {
  it("returns clusters once data is loaded", () => {
    const options = { radius: 64, maxZoom: 12 };
    const { result } = renderHook(() => useSupercluster(geojson, options));
    expect(result.current.clusters.length).toBeGreaterThan(0);
  });

  // A new clusterer (new options identity, or Fast Refresh re-running useMemo)
  // must not be queried before its data is loaded.
  it("does not query a new clusterer before loading it", () => {
    const { result, rerender } = renderHook(
      ({ radius }) => useSupercluster(geojson, { radius, maxZoom: 12 }),
      { initialProps: { radius: 64 } },
    );
    expect(() => rerender({ radius: 32 })).not.toThrow();
    expect(result.current.clusters.length).toBeGreaterThan(0);
  });
});
