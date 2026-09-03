import type { Point } from "./types";

export function fuzzyScore(query: string, target: string): number | null {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return null;
  const haystack = target.toLowerCase();
  let score = 0;
  let streak = 0;
  let qIndex = 0;

  for (let i = 0; i < haystack.length && qIndex < trimmedQuery.length; i++) {
    if (haystack[i] === trimmedQuery[qIndex]) {
      score += 1 + streak;
      if (i === 0 || haystack[i - 1] === " " || haystack[i - 1] === "-") {
        score += 2;
      }
      streak++;
      qIndex++;
    } else {
      streak = 0;
    }
  }

  return qIndex < trimmedQuery.length ? null : score - haystack.length * 0.01;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points;
  const sorted = [...points].sort((p1, p2) =>
    p1.lng === p2.lng ? p1.lat - p2.lat : p1.lng - p2.lng,
  );
  const lower: Point[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function createCircleBuffer(
  center: { lat: number; lng: number },
  radiusDegrees: number,
  segments = 8,
): Point[] {
  const circle: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    circle.push({
      lat: center.lat + radiusDegrees * Math.cos(angle),
      lng: center.lng + radiusDegrees * Math.sin(angle),
    });
  }
  return circle;
}

export function createStarPolygon(
  center: { lat: number; lng: number },
  radiusDegrees: number,
  numPoints = 5,
): Point[] {
  const star: Point[] = [];
  const inner = radiusDegrees * 0.4;
  for (let i = 0; i < numPoints * 2; i++) {
    const angle = (i * Math.PI) / numPoints - Math.PI / 2;
    const r = i % 2 === 0 ? radiusDegrees : inner;
    star.push({
      lat: center.lat + r * Math.cos(angle),
      lng: center.lng + r * Math.sin(angle),
    });
  }
  return star;
}

/** Spherical polygon area in square miles (Haversine-based shoelace). */
export function polygonAreaSqMi(points: Point[]): number {
  if (points.length < 3) return 0;
  // Earth radius in miles
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const rawDelta = p2.lng - p1.lng;
    const deltaLng =
      rawDelta > 180
        ? rawDelta - 360
        : rawDelta < -180
          ? rawDelta + 360
          : rawDelta;
    area +=
      toRad(deltaLng) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((area * R * R) / 2);
}
