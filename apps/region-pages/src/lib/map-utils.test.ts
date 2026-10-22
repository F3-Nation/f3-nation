import { describe, expect, it } from "vitest";

import {
  calculateHaversineDistance,
  getMapUrl,
  regionMapParameters,
} from "@/lib/map-utils";

describe("calculateHaversineDistance", () => {
  it("returns 0 for the same point", () => {
    expect(calculateHaversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(
      0,
    );
  });

  it("returns kilometers (London to Paris is ~344 km)", () => {
    const km = calculateHaversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(347);
  });
});

describe("getMapUrl", () => {
  it("builds the F3 map URL from center and zoom", () => {
    expect(getMapUrl({ center: { lat: 40.5, lng: -74.25 }, zoom: 11 })).toBe(
      "https://map.f3nation.com/?lat=40.5&lon=-74.25&zoom=11",
    );
  });
});

describe("regionMapParameters", () => {
  it("uses the region's center and zoom", () => {
    expect(
      regionMapParameters({ latitude: 35.1, longitude: -106.6, zoom: 10 }),
    ).toEqual({ center: { lat: 35.1, lng: -106.6 }, zoom: 10 });
  });

  it("falls back to the whole US when the region has no location", () => {
    expect(
      regionMapParameters({ latitude: null, longitude: null, zoom: null }),
    ).toEqual({ center: { lat: 39.8283, lng: -98.5795 }, zoom: 4 });
  });
});
