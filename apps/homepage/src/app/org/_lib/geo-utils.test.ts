import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  convexHull,
  createCircleBuffer,
  createStarPolygon,
  polygonAreaSqMi,
} from "./geo-utils";
import type { Point } from "./types";

describe("fuzzyScore", () => {
  it("returns null for empty query", () => {
    expect(fuzzyScore("", "anything")).toBeNull();
    expect(fuzzyScore("  ", "anything")).toBeNull();
  });

  it("returns null when query chars are not all found in target", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });

  it("returns a positive score for an exact match", () => {
    const score = fuzzyScore("hello", "hello");
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0);
  });

  it("scores a word-start match higher than mid-word match", () => {
    const start = fuzzyScore("sea", "Seattle")!;
    const mid = fuzzyScore("att", "Seattle")!;
    expect(start).toBeGreaterThan(mid);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("ABC", "abc")).toEqual(fuzzyScore("abc", "abc"));
  });

  it("returns a score for partial matches", () => {
    const score = fuzzyScore("F3", "F3 Charlotte");
    expect(score).not.toBeNull();
  });

  it("penalizes longer target strings slightly", () => {
    const short = fuzzyScore("F3", "F3")!;
    const long = fuzzyScore("F3", "F3 Charlotte")!;
    expect(short).toBeGreaterThan(long);
  });
});

describe("convexHull", () => {
  it("returns the same single point", () => {
    const pts: Point[] = [{ lat: 0, lng: 0 }];
    expect(convexHull(pts)).toEqual(pts);
  });

  it("returns both points for a two-point input", () => {
    const pts: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    expect(convexHull(pts)).toHaveLength(2);
  });

  it("computes the hull of a square", () => {
    const pts: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
      { lat: 0.5, lng: 0.5 }, // interior point should be excluded
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
  });

  it("handles collinear points", () => {
    const pts: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.5 },
      { lat: 1, lng: 1 },
    ];
    const hull = convexHull(pts);
    // Collinear points collapse to the two endpoints
    expect(hull.length).toBeLessThanOrEqual(3);
  });

  it("returns a valid hull for a triangle", () => {
    const pts: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 2, lng: 0 },
      { lat: 1, lng: 2 },
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(3);
  });
});

describe("createCircleBuffer", () => {
  it("returns the requested number of segments", () => {
    const pts = createCircleBuffer({ lat: 0, lng: 0 }, 1, 8);
    expect(pts).toHaveLength(8);
  });

  it("defaults to 8 segments", () => {
    const pts = createCircleBuffer({ lat: 0, lng: 0 }, 1);
    expect(pts).toHaveLength(8);
  });

  it("all points are within radius of center", () => {
    const center = { lat: 10, lng: -80 };
    const r = 0.5;
    const pts = createCircleBuffer(center, r, 16);
    for (const p of pts) {
      const dlat = p.lat - center.lat;
      const dlng = p.lng - center.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      expect(dist).toBeCloseTo(r, 5);
    }
  });
});

describe("createStarPolygon", () => {
  it("returns 2 × numPoints vertices", () => {
    const pts = createStarPolygon({ lat: 0, lng: 0 }, 5, 5);
    expect(pts).toHaveLength(10);
  });

  it("defaults to 5 points (10 vertices)", () => {
    const pts = createStarPolygon({ lat: 0, lng: 0 }, 3);
    expect(pts).toHaveLength(10);
  });

  it("outer vertices are farther from center than inner", () => {
    const center = { lat: 0, lng: 0 };
    const r = 4;
    const pts = createStarPolygon(center, r, 5);
    const dist = (p: Point) =>
      Math.sqrt((p.lat - center.lat) ** 2 + (p.lng - center.lng) ** 2);
    // Even-indexed = outer, odd-indexed = inner
    expect(dist(pts[0]!)).toBeGreaterThan(dist(pts[1]!));
    expect(dist(pts[2]!)).toBeGreaterThan(dist(pts[3]!));
  });
});

describe("polygonAreaSqMi", () => {
  it("returns 0 for fewer than 3 points", () => {
    expect(polygonAreaSqMi([])).toBe(0);
    expect(polygonAreaSqMi([{ lat: 0, lng: 0 }])).toBe(0);
    expect(
      polygonAreaSqMi([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toBe(0);
  });

  it("returns a positive area for a valid polygon", () => {
    // Roughly 1° × 1° box near equator ≈ 4,800–5,000 sq mi
    const pts: Point[] = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
    ];
    const area = polygonAreaSqMi(pts);
    expect(area).toBeGreaterThan(0);
  });

  it("larger polygon has larger area", () => {
    const small: Point[] = [
      { lat: 35, lng: -80 },
      { lat: 36, lng: -80 },
      { lat: 36, lng: -79 },
    ];
    const large: Point[] = [
      { lat: 35, lng: -85 },
      { lat: 40, lng: -85 },
      { lat: 40, lng: -75 },
      { lat: 35, lng: -75 },
    ];
    expect(polygonAreaSqMi(large)).toBeGreaterThan(polygonAreaSqMi(small));
  });
});
