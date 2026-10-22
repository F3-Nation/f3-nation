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

  it("keys each AO at a shared location uniquely and collapses repeated AO names", () => {
    const baseEvent = locationMarker.events[0]!;
    const sharedLocation: SparseF3Marker = {
      ...locationMarker,
      id: 7,
      events: [
        { ...baseEvent, id: 70, name: "Tower Mon", aoName: "The Dark Tower" },
        { ...baseEvent, id: 71, name: "Tower Wed", aoName: "The Dark Tower" },
        {
          ...baseEvent,
          id: 72,
          name: "Gunslinger Run",
          aoName: "The Gunslinger",
        },
      ],
    };

    const results = buildF3LocationSearchResults({
      locationMarkers: [sharedLocation],
      text: "the",
    });

    expect(results.map((result) => result.header)).toEqual([
      "The Dark Tower",
      "The Gunslinger",
    ]);
    expect(results.map((result) => result.destination.id)).toEqual([7, 7]);
    const keys = results.map((result) => result.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
