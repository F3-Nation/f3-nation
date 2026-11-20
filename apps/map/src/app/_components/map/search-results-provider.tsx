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

const NO_GEO_RESULTS: GeoMapSearchResult[] = [];

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

  if (text.length > 0 && !searchEngaged) {
    setSearchEngaged(true);
  }

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

  const [geoState, setGeoState] = useState<{
    query: string;
    results: GeoMapSearchResult[];
  }>({ query: "", results: NO_GEO_RESULTS });

  const f3RegionResults = useMemo(() => {
    if (text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS) return [];

    return (
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
        .filter(({ header }) =>
          header.toLowerCase().includes(text.toLowerCase()),
        ) ?? []
    );
  }, [regions, text]);

  const f3LocationResults = useMemo(() => {
    if (text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS) return [];

    return buildF3LocationSearchResults({
      locationMarkers: filteredLocationMarkers,
      text,
      eventIdToRegionNameLookup,
      locationIdToRegionNameLookup,
    });
  }, [
    filteredLocationMarkers,
    text,
    eventIdToRegionNameLookup,
    locationIdToRegionNameLookup,
  ]);

  useEffect(() => {
    if (text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS) {
      return;
    }

    let active = true;
    const cleanup = debouncedPlacesAutocomplete(
      text,
      mapStore.get("center"),
      mapStore.get("zoom"),
      (results) => {
        if (!active) return;
        setGeoState({
          query: text,
          results: results.flatMap(({ placePrediction }) =>
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
        });
      },
    );

    return () => {
      active = false;
      cleanup();
    };
  }, [text]);

  const visibleGeoResults =
    text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS ||
    geoState.query !== text
      ? NO_GEO_RESULTS
      : geoState.results;

  const combinedResults = useMemo(() => {
    if (text.length < MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS) return [];

    return isMobileWidth
      ? [
          ...f3LocationResults.slice(0, 10),
          ...f3RegionResults.slice(0, 10),
          ...visibleGeoResults.slice(0, 10),
        ]
      : [
          ...visibleGeoResults.slice(0, 10),
          ...f3LocationResults.slice(0, 10),
          ...f3RegionResults.slice(0, 10),
        ];
  }, [
    f3LocationResults,
    f3RegionResults,
    visibleGeoResults,
    isMobileWidth,
    text,
  ]);

  return (
    <TextSearchResultsContext.Provider
      value={{
        f3RegionResults,
        f3LocationResults,
        geoResults: visibleGeoResults,
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
