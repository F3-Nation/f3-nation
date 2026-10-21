import { describe, expect, it } from "vitest";

import type { SparseF3Marker } from "~/utils/types";

import { buildF3LocationSearchResults } from "~/app/_components/map/search-results";

const locationMarker: SparseF3Marker = {
  id: 2,
  lat: 35.5,
  lon: -80.5,
  logo: null,
  aoName: "The Dark Tower",
  fullAddress: "123 Main St",
  events: [
    {
      id: 2,
      name: "The Dark Tower Bootcamp",
      dayOfWeek: "monday",
      startTime: "0530",
      eventTypes: [],
      aoName: "The Dark Tower",
      aoLogo: null,
      startDate: "2026-01-01",
      endDate: null,
      mapStatus: null,
    },
  ],
};

describe("buildF3LocationSearchResults", () => {
  it("gives a location and an event with the same id unique keys", () => {
    const results = buildF3LocationSearchResults({
      locationMarkers: [locationMarker],
      text: "The",
      eventIdToRegionNameLookup: {},
      locationIdToRegionNameLookup: {},
    });

    expect(results.map((result) => result.destination.id)).toEqual([2, 2]);
    expect(results.map((result) => result.key)).toEqual([
      "ao-2-The Dark Tower",
      "event-2",
    ]);
    expect(new Set(results.map((result) => result.key)).size).toBe(
      results.length,
    );
  });
});
