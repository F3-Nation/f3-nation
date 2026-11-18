/** One pin that could show a day label. */
export interface LabelCandidate {
  id: number;
  lat: number;
  lng: number;
  /** Day segments the label would show ("Tu Th Sa" is 3). */
  segments: number;
  /** Always labeled, and placed first (the open or selected location). */
  pinned?: boolean;
}

/** Day label size in CSS pixels: 26px per segment, 24px pill + 8px tail. */
const LABEL_SEGMENT_WIDTH = 27;
const LABEL_HEIGHT = 32;
/** Space kept between two labels so their edges don't touch. */
const GAP = 2;

/** Web Mercator world pixel at `zoom` (256px tiles), as Google Maps uses. */
function toPixel(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.min(
    Math.max(Math.sin((lat * Math.PI) / 180), -0.9999),
    0.9999,
  );
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Which pins get their day label at this zoom. A label that would overlap one
 * already placed stays a plain pin until the map is zoomed in far enough to
 * fit it, so labels never cover each other. Pinned pins go first, then pins
 * with more workout days, then by id so the result is stable.
 */
export function pickLabeledPins(
  candidates: readonly LabelCandidate[],
  zoom: number,
): Set<number> {
  const order = [...candidates].sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.segments - a.segments ||
      a.id - b.id,
  );
  const placed: { left: number; right: number; top: number; bottom: number }[] =
    [];
  const labeled = new Set<number>();
  for (const pin of order) {
    const { x, y } = toPixel(pin.lat, pin.lng, zoom);
    const half = (Math.max(pin.segments, 1) * LABEL_SEGMENT_WIDTH) / 2;
    // The label sits above its point, centered on it.
    const box = {
      left: x - half,
      right: x + half,
      top: y - LABEL_HEIGHT,
      bottom: y,
    };
    const hits = placed.some(
      (p) =>
        box.left < p.right + GAP &&
        box.right > p.left - GAP &&
        box.top < p.bottom + GAP &&
        box.bottom > p.top - GAP,
    );
    if (hits && !pin.pinned) continue;
    placed.push(box);
    labeled.add(pin.id);
  }
  return labeled;
}
