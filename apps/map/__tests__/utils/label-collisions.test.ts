import { describe, expect, it } from "vitest";

import { labeledPinIds, pickLabeledPins } from "~/utils/label-collisions";

// At zoom 12 near Charlotte one CSS pixel is about 0.0000839° of longitude.
const PX = 360 / (256 * 2 ** 12);

describe("pickLabeledPins", () => {
  it("labels pins whose labels don't touch", () => {
    const labeled = pickLabeledPins(
      [
        { id: 1, lat: 35.2, lng: -80.8, segments: 3 },
        { id: 2, lat: 35.2, lng: -80.8 + 200 * PX, segments: 3 },
      ],
      12,
    );
    expect([...labeled].sort()).toEqual([1, 2]);
  });

  it("keeps the second of two overlapping labels as a plain pin", () => {
    const labeled = pickLabeledPins(
      [
        { id: 1, lat: 35.2, lng: -80.8, segments: 3 },
        { id: 2, lat: 35.2, lng: -80.8 + 30 * PX, segments: 3 },
      ],
      12,
    );
    expect([...labeled]).toEqual([1]);
  });

  it("labels both once zoomed in far enough", () => {
    const pins = [
      { id: 1, lat: 35.2, lng: -80.8, segments: 3 },
      { id: 2, lat: 35.2, lng: -80.8 + 30 * PX, segments: 3 },
    ];
    expect(pickLabeledPins(pins, 12).size).toBe(1);
    expect(pickLabeledPins(pins, 14).size).toBe(2);
  });

  it("prefers the pin with more workout days, then the lower id", () => {
    const near = -80.8 + 10 * PX;
    expect([
      ...pickLabeledPins(
        [
          { id: 1, lat: 35.2, lng: -80.8, segments: 1 },
          { id: 2, lat: 35.2, lng: near, segments: 4 },
        ],
        12,
      ),
    ]).toEqual([2]);
    expect([
      ...pickLabeledPins(
        [
          { id: 9, lat: 35.2, lng: near, segments: 2 },
          { id: 3, lat: 35.2, lng: -80.8, segments: 2 },
        ],
        12,
      ),
    ]).toEqual([3]);
  });

  it("always labels a pinned pin, even over another label", () => {
    const labeled = pickLabeledPins(
      [
        { id: 1, lat: 35.2, lng: -80.8, segments: 5 },
        { id: 2, lat: 35.2, lng: -80.8 + 10 * PX, segments: 1, pinned: true },
      ],
      12,
    );
    expect(labeled.has(2)).toBe(true);
    expect(labeled.has(1)).toBe(false);
  });

  it("ignores labels stacked vertically far enough apart", () => {
    const labeled = pickLabeledPins(
      [
        { id: 1, lat: 35.2, lng: -80.8, segments: 3 },
        // ~50px south: below the first label's 32px height.
        {
          id: 2,
          lat: 35.2 - 50 * PX * Math.cos((35.2 * Math.PI) / 180),
          lng: -80.8,
          segments: 3,
        },
      ],
      12,
    );
    expect(labeled.size).toBe(2);
  });
});

describe("labeledPinIds", () => {
  const point = (id: number, lng: number) => ({
    id,
    geometry: { coordinates: [lng, 35.2] },
    properties: {},
  });
  const events = (id: number, days: ("monday" | "tuesday" | "friday")[]) => ({
    id,
    events: days.map((dayOfWeek, i) => ({
      id: id * 10 + i,
      dayOfWeek,
      mapStatus: null,
    })),
  });

  it("skips clusters and sizes labels from each pin's workout days", () => {
    const labeled = labeledPinIds({
      clusters: [
        point(1, -80.8),
        point(2, -80.8 + 30 * PX),
        {
          id: 99,
          geometry: { coordinates: [-80.8, 35.2] },
          properties: { cluster: true },
        },
      ],
      modifiedLocationMarkers: {},
      locationMarkers: [
        events(1, ["monday"]),
        events(2, ["monday", "tuesday", "friday"]),
      ],
      pinnedIds: [],
      zoom: 12,
    });
    expect([...labeled]).toEqual([2]);
  });

  it("uses a pin's edited position and keeps the selected pin labeled", () => {
    const labeled = labeledPinIds({
      clusters: [point(1, -80.8), point(2, -80.0)],
      // Pin 2 dragged right next to pin 1.
      modifiedLocationMarkers: { "2": { lat: 35.2, lng: -80.8 + 10 * PX } },
      locationMarkers: [events(1, ["monday", "friday"]), events(2, ["monday"])],
      pinnedIds: [2, null],
      zoom: 12,
    });
    expect([...labeled]).toEqual([2]);
  });

  it("ignores features without numeric coordinates", () => {
    const labeled = labeledPinIds({
      clusters: [{ id: 5, geometry: { coordinates: [] }, properties: {} }],
      modifiedLocationMarkers: {},
      locationMarkers: [],
      pinnedIds: [],
      zoom: 12,
    });
    expect(labeled.size).toBe(0);
  });
});
