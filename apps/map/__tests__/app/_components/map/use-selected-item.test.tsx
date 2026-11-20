import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const data: { current: unknown } = { current: undefined };
  const markers: { current: Record<number, { lat: number; lng: number }> } = {
    current: {},
  };
  const eventId: { current: number | null } = { current: null };
  const instances: { current: unknown[] } = { current: [] };
  return { data, markers, eventId, instances };
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
  useUpcomingInstances: () => ({ instances: h.instances.current }),
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
    use: { locationId: () => 7, eventId: () => h.eventId.current },
  },
}));

import { useSelectedItem } from "~/app/_components/map/use-selected-item";

describe("useSelectedItem", () => {
  beforeEach(() => {
    h.markers.current = {};
    h.eventId.current = null;
    h.instances.current = [];
  });

  it("gives a one-off instance pin its description, and a series date none", () => {
    h.data.current = { location: { id: 7, lat: 10, lon: 20, events: [] } };
    const instance = (id: number, seriesId: number | null) => ({
      id,
      seriesId,
      name: `Instance ${id}`,
      description: `Note ${id}`,
      startDate: "2026-11-26",
      startTime: "0700",
      endTime: "0800",
      seriesException: null,
      eventTypes: [],
      aoName: "Alpha AO",
      aoLogo: null,
    });
    h.instances.current = [instance(41, null), instance(42, 9)];

    h.eventId.current = -41;
    const { result, rerender } = renderHook(() => useSelectedItem());
    expect(result.current.selectedEvent?.description).toBe("Note 41");

    // A series date's note sits beside its change, not in the hover card's
    // description.
    h.eventId.current = -42;
    rerender();
    expect(result.current.selectedEvent?.description).toBeNull();
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
