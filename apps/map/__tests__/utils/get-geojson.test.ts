import { describe, expect, it } from "vitest";

import { getGeojson } from "~/utils/get-geojson";
import type { SparseF3Marker } from "~/utils/types";

const marker = (overrides: Partial<SparseF3Marker>): SparseF3Marker => ({
  id: 1,
  lat: 35.2271,
  lon: -80.8431,
  logo: "https://example.com/logo.png",
  aoName: "The Ruckus",
  fullAddress: "123 Main St, Charlotte, NC",
  events: [],
  ...overrides,
});

describe("getGeojson", () => {
  it("converts markers with coordinates into GeoJSON point features", () => {
    const geojson = getGeojson([marker({ id: 7 })]);

    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toEqual([
      {
        id: 7,
        type: "Feature",
        geometry: { type: "Point", coordinates: [-80.8431, 35.2271] },
        properties: {
          name: "The Ruckus",
          address: "123 Main St, Charlotte, NC",
          logo: "https://example.com/logo.png",
        },
      },
    ]);
  });

  it("skips markers missing a lat or lon", () => {
    const geojson = getGeojson([
      marker({ id: 1, lat: null }),
      marker({ id: 2, lon: null }),
      marker({ id: 3 }),
    ]);

    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0]?.id).toBe(3);
  });

  it("returns an empty FeatureCollection for an empty marker list", () => {
    expect(getGeojson([])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
