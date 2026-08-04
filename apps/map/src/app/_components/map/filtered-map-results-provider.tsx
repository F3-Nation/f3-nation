"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import { DEFAULT_CENTER } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { groupMarkersByAo } from "~/utils/group-markers-by-ao";
import type { MapStatus, SparseF3Marker } from "~/utils/types";
import { orpc, useQuery } from "~/orpc/react";
import { dateToDayOfWeek } from "~/utils/date-to-day-of-week";
import { getMapEventStatus, instanceMapStatus } from "~/utils/event-status-map";
import { filterData } from "~/utils/filtered-data";
import { filterStore } from "~/utils/store/filter";
import { mapStore } from "~/utils/store/map";

export type LocationMarkerWithDistance = SparseF3Marker & {
  distance: number | null;
};

export type AoGroupedLocationMarker = LocationMarkerWithDistance & {
  aoId: string;
};

interface UpcomingMapInstance {
  id: number;
  seriesId: number | null;
  locationId: number | null;
  startDate: string;
  startTime: string | null;
  seriesException: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
  aoName: string | null;
  aoLogo: string | null;
  fullAddress: string | null;
  eventTypes: { id: number; name: string }[];
}

const createSyntheticEventFromInstance = (
  instance: UpcomingMapInstance,
): SparseF3Marker["events"][number] => {
  // Shared with the chip and "Updates" colorings so all three stay in step —
  // this was an inline copy of the same ladder.
  const mapStatus: MapStatus = instanceMapStatus(instance.seriesException);

  return {
    id: -instance.id,
    name: instance.name,
    dayOfWeek: dateToDayOfWeek(instance.startDate),
    startTime: instance.startTime,
    eventTypes: instance.eventTypes,
    startDate: instance.startDate,
    endDate: null,
    aoName: instance.aoName ?? "",
    aoLogo: instance.aoLogo,
    mapStatus,
  };
};

export function mergeUpcomingInstancesIntoMarkers({
  locationMarkers,
  upcomingInstancesData,
}: {
  locationMarkers: SparseF3Marker[];
  upcomingInstancesData: UpcomingMapInstance[] | undefined;
}) {
  const markersByLocationId = new Map<number, SparseF3Marker>();
  const locationIdsBySeriesId = new Map<number, Set<number>>();

  for (const marker of locationMarkers) {
    markersByLocationId.set(marker.id, marker);
    for (const event of marker.events) {
      if (event.id < 0) continue;
      let locs = locationIdsBySeriesId.get(event.id);
      if (!locs) {
        locs = new Set<number>();
        locationIdsBySeriesId.set(event.id, locs);
      }
      locs.add(marker.id);
    }
  }

  for (const instance of upcomingInstancesData ?? []) {
    if (
      instance.locationId == null ||
      instance.lat == null ||
      instance.lon == null
    )
      continue;
    if (
      instance.seriesId != null &&
      locationIdsBySeriesId.get(instance.seriesId)?.has(instance.locationId)
    )
      continue;

    const instanceEvent = createSyntheticEventFromInstance(instance);
    const existing = markersByLocationId.get(instance.locationId);

    if (existing) {
      existing.events.push(instanceEvent);
      continue;
    }

    const marker: SparseF3Marker = {
      id: instance.locationId,
      aoName: instance.aoName ?? "",
      logo: instance.aoLogo,
      lat: instance.lat,
      lon: instance.lon,
      fullAddress: instance.fullAddress,
      events: [instanceEvent],
    };
    markersByLocationId.set(instance.locationId, marker);
    locationMarkers.push(marker);
  }
}

const FilteredMapResultsContext = createContext<{
  nearbyLocationCenter: ReturnType<typeof mapStore.use.nearbyLocationCenter>;
  filteredLocationMarkers: SparseF3Marker[] | undefined;
  locationOrderedLocationMarkers: LocationMarkerWithDistance[] | undefined;
  aoGroupedLocationMarkers: AoGroupedLocationMarker[] | undefined;
  allLocationMarkersWithLatLngAndFilterData: SparseF3Marker[] | undefined;
}>({
  nearbyLocationCenter: {
    type: "default",
    lat: DEFAULT_CENTER[0],
    lng: DEFAULT_CENTER[1],
    name: null,
  },
  filteredLocationMarkers: undefined,
  locationOrderedLocationMarkers: undefined,
  aoGroupedLocationMarkers: undefined,
  allLocationMarkersWithLatLngAndFilterData: undefined,
});

export const FilteredMapResultsProvider = (params: { children: ReactNode }) => {
  RERENDER_LOGS && console.log("FilteredMapResultsProvider rerender");
  const nearbyLocationCenter = mapStore.use.nearbyLocationCenter();
  const { data: mapEventAndLocationData } = useQuery(
    orpc.map.location.eventsAndLocations.queryOptions({
      input: undefined,
    }),
  );

  const { data: upcomingInstancesData } = useQuery(
    orpc.map.location.upcomingInstances.queryOptions({
      input: undefined,
    }),
  );

  const filters = filterStore.useBoundStore();

  /**
   * Get the location markers with the lat and lng and filter data
   */
  const allLocationMarkersWithLatLngAndFilterData = useMemo(() => {
    if (!mapEventAndLocationData) return undefined;

    const instancesBySeriesId = new Map<
      number,
      { seriesException: string | null; startDate: string }[]
    >();

    if (upcomingInstancesData) {
      for (const instance of upcomingInstancesData) {
        if (instance.seriesId != null) {
          const list = instancesBySeriesId.get(instance.seriesId) ?? [];
          list.push({
            seriesException: instance.seriesException,
            startDate: instance.startDate,
          });
          instancesBySeriesId.set(instance.seriesId, list);
        }
      }
    }

    const allLocationMarkerFilterData = mapEventAndLocationData.map(
      (location) => {
        return {
          id: location[0],
          aoName: location[1],
          logo: location[2],
          lat: location[3],
          lon: location[4],
          fullAddress: location[5],
          events: location[6].map((event) => {
            const eventObj = {
              id: event[0],
              name: event[1],
              dayOfWeek: event[2],
              startTime: event[3],
              eventTypes: event[4],
              aoName: event[5],
              aoLogo: event[6],
              startDate: event[7],
              endDate: event[8],
            };
            return {
              ...eventObj,
              mapStatus: getMapEventStatus(eventObj, instancesBySeriesId),
            };
          }),
        };
      },
    );

    mergeUpcomingInstancesIntoMarkers({
      locationMarkers: allLocationMarkerFilterData,
      upcomingInstancesData,
    });

    return allLocationMarkerFilterData;
  }, [mapEventAndLocationData, upcomingInstancesData]);

  /**
   * Filter the location markers by the filters
   */
  const filteredLocationMarkers = useMemo(() => {
    if (!allLocationMarkersWithLatLngAndFilterData) return undefined;

    const filteredLocationMarkers = filterData(
      allLocationMarkersWithLatLngAndFilterData,
      filters,
    );
    return filteredLocationMarkers;
  }, [allLocationMarkersWithLatLngAndFilterData, filters]);

  /**
   * Sort the location markers by distance to the nearby location center
   */
  const locationOrderedLocationMarkers = useMemo(() => {
    if (!filteredLocationMarkers || !nearbyLocationCenter) {
      return undefined;
    }

    const locationMarkersWithDistances = filteredLocationMarkers.map(
      (location) => {
        const distance = latLngToDistance(
          location.lat ?? null,
          location.lon ?? null,
          nearbyLocationCenter?.lat ?? null,
          nearbyLocationCenter?.lng ?? null,
        );
        return { ...location, distance };
      },
    );

    const sortedLocationMarkersWithDistances =
      locationMarkersWithDistances.sort((a, b) => {
        if (a.distance === null || b.distance === null) return 0;
        return a.distance - b.distance;
      });
    return sortedLocationMarkersWithDistances;
  }, [nearbyLocationCenter, filteredLocationMarkers]);

  const aoGroupedLocationMarkers = useMemo(() => {
    if (!locationOrderedLocationMarkers) return undefined;
    return groupMarkersByAo(locationOrderedLocationMarkers);
  }, [locationOrderedLocationMarkers]);

  return (
    <FilteredMapResultsContext.Provider
      value={{
        filteredLocationMarkers,
        locationOrderedLocationMarkers,
        aoGroupedLocationMarkers,
        allLocationMarkersWithLatLngAndFilterData,
        nearbyLocationCenter,
      }}
    >
      {params.children}
    </FilteredMapResultsContext.Provider>
  );
};

export const useFilteredMapResults = () => {
  return useContext(FilteredMapResultsContext);
};

const latLngToDistance = (
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
) => {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null)
    return null;

  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180; // φ, λ in radians
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return (R * c) / 1609.34; // in metres
};
