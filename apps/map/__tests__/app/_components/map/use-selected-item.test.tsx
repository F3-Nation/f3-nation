import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const data: { current: unknown } = { current: undefined };
  const markers: { current: Record<number, { lat: number; lng: number }> } = {
    current: {},
  };
  return { data, markers };
});

vi.mock("@vis.gl/react-google-maps", () => ({ useMap: () => null }));
vi.mock("~/orpc/react", () => ({
  orpc: {
    map: {
      location: {
        locationWorkout: { queryOptions: (options: unknown) => options },
      },
    },
  },
  useQuery: () => ({ data: h.data.current }),
}));
vi.mock("~/utils/hooks/use-upcoming-instances", () => ({
  useUpcomingInstances: () => ({ instances: [] }),
}));
vi.mock("~/utils/store/map", () => ({
  mapStore: {
    use: {
      zoom: () => 15,
      modifiedLocationMarkers: () => h.markers.current,
    },
    get: () => undefined,
  },
}));
vi.mock("~/utils/store/selected-item", () => ({
  selectedItemStore: {
    use: { locationId: () => 7, eventId: () => null },
  },
}));

import { useSelectedItem } from "~/app/_components/map/use-selected-item";

describe("useSelectedItem", () => {
  beforeEach(() => {
    h.markers.current = {};
  });

  it("shows draft marker coordinates without writing them into cached data", () => {
    const cached = { id: 7, lat: 10, lon: 20, events: [] };
    h.data.current = { location: cached };

    const { result, rerender } = renderHook(() => useSelectedItem());
    expect(result.current.selectedLocation).toMatchObject({ lat: 10, lon: 20 });

    h.markers.current = { 7: { lat: 11, lng: 21 } };
    rerender();
    expect(result.current.selectedLocation).toMatchObject({ lat: 11, lon: 21 });
    expect(cached).toMatchObject({ lat: 10, lon: 20 });

    h.markers.current = {};
    rerender();
    expect(result.current.selectedLocation).toMatchObject({ lat: 10, lon: 20 });
    expect(cached).toMatchObject({ lat: 10, lon: 20 });
  });
});
