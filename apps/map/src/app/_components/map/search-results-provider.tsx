"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { MAP_DATASET_STALE_TIME_MS } from "~/orpc/query-client";
import { orpc, useQuery } from "~/orpc/react";
import { useIsMobileWidth } from "~/utils/hooks/use-is-mobile-width";
import { debouncedPlacesAutocomplete } from "~/utils/place-autocomplete";
import { mapStore } from "~/utils/store/map";
import { searchStore } from "~/utils/store/search";
import type {
  F3LocationMapSearchResult,
  F3RegionMapSearchResult,
  GeoMapSearchResult,
} from "~/utils/types";
import { useFilteredMapResults } from "./filtered-map-results-provider";
import { buildF3LocationSearchResults } from "./search-results";

const TextSearchResultsContext = createContext<{
  f3RegionResults: F3RegionMapSearchResult[];
  f3LocationResults: F3LocationMapSearchResult[];
  geoResults: GeoMapSearchResult[];
  combinedResults: (
    F3LocationMapSearchResult | GeoMapSearchResult | F3RegionMapSearchResult
  )[];
}>({
  f3RegionResults: [],
  f3LocationResults: [],
  geoResults: [],
  combinedResults: [],
});

export const TextSearchResultsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  RERENDER_LOGS && console.log("TextSearchResultsProvider rerender");
  const text = searchStore.use.text();

  const [searchEngaged, setSearchEngaged] = useState(false);
  useEffect(() => {
    if (text.length > 0) setSearchEngaged(true);
  }, [text]);

  const { data: regionsResponse } = useQuery(
    orpc.map.location.regionsWithLocation.queryOptions({
      input: undefined,
      enabled: searchEngaged,
      staleTime: MAP_DATASET_STALE_TIME_MS,
    }),
  );
  const regions = regionsResponse?.regionsWithLocation;
  const { data: eventIdToRegionNameLookupResponse } = useQuery(
    orpc.event.eventIdToRegionNameLookup.queryOptions({
      input: undefined,
      enabled: searchEngaged,
    }),
  );
  const eventIdToRegionNameLookup = eventIdToRegionNameLookupResponse?.lookup;
  const { data: locationIdToRegionNameLookupResponse } = useQuery(
    orpc.map.location.locationIdToRegionNameLookup.queryOptions({
      input: undefined,
      enabled: searchEngaged,
    }),
  );
  const locationIdToRegionNameLookup =
    locationIdToRegionNameLookupResponse?.lookup;
  const { isMobileWidth } = useIsMobileWidth();
  const { filteredLocationMarkers } = useFilteredMapResults();

  const [geoResults, setGeoResults] = useState<GeoMapSearchResult[]>([]);
  const [f3LocationResults, setF3LocationResults] = useState<
    F3LocationMapSearchResult[]
  >([]);
  const [f3RegionResults, setF3RegionResults] = useState<
    F3RegionMapSearchResult[]
  >([]);

  useEffect(() => {
    if (text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS) return;
    // Use refs to prevent this from running on every center / zoom updated

    const _f3RegionResults =
      regions
        ?.map((region) => ({
          key: `region-${region.id}`,
          header: region.name,
          type: "region" as const,
          destination: {
            id: region.id,
            lat: region.lat,
            lng: region.lon,
            logo: region.logo,
            locationId: region.locationId,
            placeId: null,
            item: null,
          },
        }))
        .filter(({ header }) => {
          return header.toLowerCase().includes(text.toLowerCase());
        }) ?? [];

    setF3RegionResults(_f3RegionResults);

    setF3LocationResults(
      buildF3LocationSearchResults({
        locationMarkers: filteredLocationMarkers,
        text,
        eventIdToRegionNameLookup,
        locationIdToRegionNameLookup,
      }),
    );

    // Use debounced autocomplete to reduce API calls
    const cleanup = debouncedPlacesAutocomplete(
      text,
      mapStore.get("center"),
      mapStore.get("zoom"),
      (results) => {
        setGeoResults(
          // Query predictions have no place to navigate to.
          results.flatMap(({ placePrediction }) =>
            placePrediction
              ? [
                  {
                    key: `geo-${placePrediction.placeId}`,
                    type: "geo" as const,
                    header: placePrediction.structuredFormat.mainText.text,
                    description:
                      placePrediction.structuredFormat.secondaryText?.text ??
                      "",
                    destination: {
                      id: placePrediction.placeId,
                      lat: null,
                      lng: null,
                      item: null,
                      placeId: placePrediction.placeId,
                    },
                  },
                ]
              : [],
          ),
        );
      },
    );

    // Cleanup on unmount or when text changes
    return cleanup;
  }, [
    filteredLocationMarkers,
    regions,
    text,
    eventIdToRegionNameLookup,
    locationIdToRegionNameLookup,
  ]);

  const combinedResults = useMemo(
    () =>
      isMobileWidth
        ? [
            ...f3LocationResults.slice(0, 10),
            ...f3RegionResults.slice(0, 10),
            ...geoResults.slice(0, 10),
          ]
        : [
            ...geoResults.slice(0, 10),
            ...f3LocationResults.slice(0, 10),
            ...f3RegionResults.slice(0, 10),
          ],
    [f3LocationResults, f3RegionResults, geoResults, isMobileWidth],
  );

  return (
    <TextSearchResultsContext.Provider
      value={{
        f3RegionResults,
        f3LocationResults,
        geoResults,
        combinedResults,
      }}
    >
      {children}
    </TextSearchResultsContext.Provider>
  );
};

export const useTextSearchResults = (): {
  f3RegionResults: F3RegionMapSearchResult[];
  f3LocationResults: F3LocationMapSearchResult[];
  geoResults: GeoMapSearchResult[];
  combinedResults: (
    F3LocationMapSearchResult | GeoMapSearchResult | F3RegionMapSearchResult
  )[];
} => {
  return useContext(TextSearchResultsContext);
};
