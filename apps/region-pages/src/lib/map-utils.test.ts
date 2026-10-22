import { describe, expect, it } from "vitest";
import {
  calculateHaversineDistance,
  calculateMapParameters,
  getMapUrl,
} from "@/lib/map-utils";

const EARTH_RADIUS_KM = 6371;
const US_CENTER = { lat: 39.8283, lng: -98.5795 };

describe("calculateHaversineDistance", () => {
  it("returns 0 for the same point", () => {
    expect(calculateHaversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(
      0,
    );
  });

  it("returns the arc length of one degree of latitude", () => {
    const oneDegreeKm = (EARTH_RADIUS_KM * Math.PI) / 180;

    expect(calculateHaversineDistance(0, 0, 1, 0)).toBeCloseTo(oneDegreeKm, 3);
  });

  it("is symmetric", () => {
    const forward = calculateHaversineDistance(
      51.5074,
      -0.1278,
      48.8566,
      2.3522,
    );
    const backward = calculateHaversineDistance(
      48.8566,
      2.3522,
      51.5074,
      -0.1278,
    );

    expect(forward).toBeCloseTo(backward, 9);
  });

  it("approximates the London to Paris distance", () => {
    const km = calculateHaversineDistance(51.5074, -0.1278, 48.8566, 2.3522);

    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(347);
  });

  it("returns half the circumference for antipodal points on the equator", () => {
    expect(calculateHaversineDistance(0, 0, 0, 180)).toBeCloseTo(
      Math.PI * EARTH_RADIUS_KM,
      3,
    );
  });
});

describe("getMapUrl", () => {
  it("builds the F3 map URL from center and zoom", () => {
    const url = getMapUrl({
      center: { lat: 40.5, lng: -74.25 },
      zoom: 11,
      markers: [],
    });

    expect(url).toBe("https://map.f3nation.com/?lat=40.5&lon=-74.25&zoom=11");
  });
});

describe("calculateMapParameters", () => {
  it("defaults to the central US at zoom 4 when there are no workouts", () => {
    expect(calculateMapParameters([])).toEqual({
      center: US_CENTER,
      zoom: 4,
      markers: [],
    });
  });

  it("defaults to the central US when no workout has coordinates", () => {
    const result = calculateMapParameters([
      { name: "No Coords", latitude: null, longitude: null },
      { name: "Half Coords", latitude: 40, longitude: null },
    ]);

    expect(result).toEqual({ center: US_CENTER, zoom: 4, markers: [] });
  });

  it("ignores workouts without coordinates when building markers", () => {
    const result = calculateMapParameters([
      { name: "Mapped", latitude: 40, longitude: -75 },
      { name: "Unmapped", latitude: null, longitude: null },
    ]);

    expect(result.markers).toEqual([{ lat: 40, lng: -75, title: "Mapped" }]);
  });

  it("centers and zooms to a single point at the maximum zoom", () => {
    const result = calculateMapParameters([
      { name: "Solo", latitude: 40, longitude: -75 },
    ]);

    expect(result.center).toEqual({ lat: 40, lng: -75 });
    expect(result.zoom).toBe(13);
    expect(result.markers).toEqual([{ lat: 40, lng: -75, title: "Solo" }]);
  });

  it("centers on the padded bounds of multiple points", () => {
    const result = calculateMapParameters([
      { name: "SW", latitude: 40, longitude: -75 },
      { name: "NE", latitude: 42, longitude: -73 },
    ]);

    expect(result.center.lat).toBeCloseTo(41, 9);
    expect(result.center.lng).toBeCloseTo(-74, 9);
  });

  it("clamps the zoom to the minimum of 4 for widely spread points", () => {
    const result = calculateMapParameters([
      { name: "West", latitude: 25, longitude: -125 },
      { name: "East", latitude: 49, longitude: -66 },
    ]);

    expect(result.zoom).toBe(4);
  });

  it("clamps the zoom to the maximum of 13 for points very close together", () => {
    const result = calculateMapParameters([
      { name: "A", latitude: 40, longitude: -75 },
      { name: "B", latitude: 40.0001, longitude: -75.0001 },
    ]);

    expect(result.zoom).toBe(13);
  });

  it("chooses an intermediate zoom for points in between the clamps", () => {
    const result = calculateMapParameters([
      { name: "A", latitude: 40, longitude: -75 },
      { name: "B", latitude: 40.1, longitude: -75.1 },
    ]);

    expect(result.zoom).toBe(11);
  });
});
