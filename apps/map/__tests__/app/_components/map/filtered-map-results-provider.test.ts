import { describe, expect, it } from "vitest";

import { mergeUpcomingInstancesIntoMarkers } from "~/app/_components/map/filtered-map-results-provider";
import type { LocationMarkerWithDistance } from "~/app/_components/map/filtered-map-results-provider";
import type { SparseF3Marker } from "~/utils/types";

const makeEvent = (
  overrides: Partial<SparseF3Marker["events"][number]> & { id: number },
): SparseF3Marker["events"][number] => {
  const { id, ...rest } = overrides;

  return {
    id,
    name: `Event ${overrides.id}`,
    dayOfWeek: "monday",
    startTime: "0530",
    eventTypes: [],
    startDate: "2026-01-01",
    endDate: null,
    mapStatus: null,
    aoName: "Default AO",
    aoLogo: null,
    ...rest,
  };
};

const makeMarker = (
  overrides: Partial<LocationMarkerWithDistance> & { id: number },
): LocationMarkerWithDistance => {
  const { id, ...rest } = overrides;

  return {
    id,
    lat: 35.5,
    lon: -80.5,
    logo: null,
    aoName: "Default AO",
    fullAddress: "123 Main St",
    events: [],
    distance: 1,
    ...rest,
  };
};

describe("mergeUpcomingInstancesIntoMarkers", () => {
  it("adds a roving series instance when the parent event has no location marker", () => {
    const locationMarkers: SparseF3Marker[] = [];

    mergeUpcomingInstancesIntoMarkers({
      locationMarkers,
      upcomingInstancesData: [
        {
          id: 42,
          seriesId: 55,
          locationId: 10,
          startDate: "2026-05-01",
          startTime: "0530",
          seriesException: null,
          name: "Roving AO",
          lat: 35.2,
          lon: -80.8,
          aoName: "Roving AO",
          aoLogo: "roving.png",
          fullAddress: "456 Park Rd",
          eventTypes: [{ id: 1, name: "Beatdown" }],
        },
      ],
    });

    expect(locationMarkers).toHaveLength(1);
    expect(locationMarkers[0]).toEqual(
      expect.objectContaining({
        id: 10,
        aoName: "Roving AO",
        events: [
          expect.objectContaining({
            id: -42,
            name: "Roving AO",
            mapStatus: "highlight",
            aoName: "Roving AO",
          }),
        ],
      }),
    );
  });

  it("does not duplicate a series event already represented at the same location", () => {
    const locationMarkers: SparseF3Marker[] = [
      makeMarker({
        id: 10,
        events: [makeEvent({ id: 55, name: "Home Event" })],
      }),
    ];

    mergeUpcomingInstancesIntoMarkers({
      locationMarkers,
      upcomingInstancesData: [
        {
          id: 42,
          seriesId: 55,
          locationId: 10,
          startDate: "2026-05-01",
          startTime: "0530",
          seriesException: null,
          name: "Home Event",
          lat: 35.2,
          lon: -80.8,
          aoName: "Home AO",
          aoLogo: "home.png",
          fullAddress: "456 Park Rd",
          eventTypes: [{ id: 1, name: "Beatdown" }],
        },
      ],
    });

    expect(locationMarkers).toHaveLength(1);
    expect(locationMarkers[0]?.events).toHaveLength(1);
    expect(locationMarkers[0]?.events[0]?.id).toBe(55);
  });

  it("adds a series instance marker when the instance is at a different location", () => {
    const locationMarkers: SparseF3Marker[] = [
      makeMarker({
        id: 1,
        aoName: "Home AO",
        events: [makeEvent({ id: 55, name: "Home Event" })],
      }),
    ];

    mergeUpcomingInstancesIntoMarkers({
      locationMarkers,
      upcomingInstancesData: [
        {
          id: 77,
          seriesId: 55,
          locationId: 2,
          startDate: "2026-05-02",
          startTime: "0600",
          seriesException: null,
          name: "Roving Event",
          lat: 35.4,
          lon: -80.9,
          aoName: "Home AO",
          aoLogo: null,
          fullAddress: "789 Field Rd",
          eventTypes: [{ id: 2, name: "Ruck" }],
        },
      ],
    });

    expect(locationMarkers).toHaveLength(2);
    expect(locationMarkers[1]).toEqual(
      expect.objectContaining({
        id: 2,
        events: [
          expect.objectContaining({
            id: -77,
            name: "Roving Event",
            startTime: "0600",
          }),
        ],
      }),
    );
  });
});
