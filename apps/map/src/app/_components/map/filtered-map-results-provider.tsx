"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import { DEFAULT_CENTER } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";

import type { SparseF3Marker } from "~/utils/types";
import { orpc, useQuery } from "~/orpc/react";
import { filterData } from "~/utils/filtered-data";
import { filterStore } from "~/utils/store/filter";
import { mapStore } from "~/utils/store/map";

export type LocationMarkerWithDistance = SparseF3Marker & {
  distance: number | null;
};

const FilteredMapResultsContext = createContext<{
  nearbyLocationCenter: ReturnType<typeof mapStore.use.nearbyLocationCenter>;
  filteredLocationMarkers: SparseF3Marker[] | undefined;
  locationOrderedLocationMarkers: LocationMarkerWithDistance[] | undefined;
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

  const filters = filterStore.useBoundStore();

  /**
   * Get the location markers with the lat and lng and filter data
   */
  const allLocationMarkersWithLatLngAndFilterData = useMemo(() => {
    if (!mapEventAndLocationData) return undefined;

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
            return {
              id: event[0],
              name: event[1],
              dayOfWeek: event[2],
              startTime: event[3],
              eventTypes: event[4],
            };
          }),
        };
      },
    );

    const locationIdToLatLng = allLocationMarkerFilterData.reduce(
      (acc, location) => {
        acc[location.id] = location;
        return acc;
      },
      {} as Record<
        number,
        {
          lat: number | null;
          lon: number | null;
          fullAddress: string | null;
        }
      >,
    );

    return allLocationMarkerFilterData.map((location) => {
      return {
        ...location,
        lat: locationIdToLatLng[location.id]?.lat ?? null,
        lon: locationIdToLatLng[location.id]?.lon ?? null,
        fullAddress: locationIdToLatLng[location.id]?.fullAddress ?? null,
      };
    });
  }, [mapEventAndLocationData]);

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

  return (
    <FilteredMapResultsContext.Provider
      value={{
        filteredLocationMarkers,
        locationOrderedLocationMarkers,
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
