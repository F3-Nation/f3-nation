"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { MIN_TEXT_LENGTH_FOR_SEARCH_RESULTS } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { isTruthy } from "@acme/shared/common/functions";

import type {
  F3LocationMapSearchResult,
  F3RegionMapSearchResult,
  GeoMapSearchResult,
} from "~/utils/types";
import { orpc, useQuery } from "~/orpc/react";
import { useIsMobileWidth } from "~/utils/hooks/use-is-mobile-width";
import { placesAutocomplete } from "~/utils/place-autocomplete";
import { mapStore } from "~/utils/store/map";
import { searchStore } from "~/utils/store/search";
import { useFilteredMapResults } from "./filtered-map-results-provider";

const TextSearchResultsContext = createContext<{
  f3RegionResults: F3RegionMapSearchResult[];
  f3LocationResults: F3LocationMapSearchResult[];
  geoResults: GeoMapSearchResult[];
  combinedResults: (
    | F3LocationMapSearchResult
    | GeoMapSearchResult
    | F3RegionMapSearchResult
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
  const { data: regions } = useQuery(
    orpc.location.getRegionsWithLocation.queryOptions({ input: undefined }),
  );
  const { data: eventIdToRegionNameLookup } = useQuery(
    orpc.event.eventIdToRegionNameLookup.queryOptions({ input: undefined }),
  );
  const { data: locationIdToRegionNameLookup } = useQuery(
    orpc.location.locationIdToRegionNameLookup.queryOptions({
      input: undefined,
    }),
  );
  const isMobileWidth = useIsMobileWidth();
  RERENDER_LOGS && console.log("TextSearchResultsProvider rerender");
  const text = searchStore.use.text();
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

    const _f3Results = [
      ...(filteredLocationMarkers
        ?.filter((data) =>
          data.aoName?.toLowerCase().includes(text.toLowerCase()),
        )
        .map((data) => {
          const searchResult: F3LocationMapSearchResult = {
            type: "location",
            header: data.aoName ?? "",
            destination: {
              id: data.id,
              lat: data.lat ?? 0,
              lng: data.lon ?? 0,
              logo: data.logo ?? "",
              item: { eventId: null, locationId: data.id },
              placeId: null,
              regionName: locationIdToRegionNameLookup?.[data.id] ?? null,
            },
          };
          return searchResult;
        }) ?? []),
      ...(filteredLocationMarkers
        ?.flatMap((location) =>
          location.events
            .filter((event) =>
              event.name.toLowerCase().includes(text.toLowerCase()),
            )
            .slice(0, 1)
            .map((event) => ({ event, location })),
        )
        .map(({ event, location }) => {
          const searchResult: F3LocationMapSearchResult = {
            type: "location",
            header: event.name,
            // description: location.locationDescription ?? "",
            destination: {
              id: event.id,
              lat: location.lat ?? 0,
              lng: location.lon ?? 0,
              logo: location.logo ?? "",
              item: { eventId: event.id, locationId: location.id },
              placeId: null,
              regionName: eventIdToRegionNameLookup?.[event.id] ?? null,
            },
          };
          return searchResult;
        }) ?? []),
    ].filter(isTruthy);

    setF3LocationResults(_f3Results);

    void placesAutocomplete({
      input: text,
      center: mapStore.get("center") ?? { lat: 37.7937, lng: -122.3965 },
      zoom: mapStore.get("zoom"),
    }).then((results) => {
      setGeoResults(
        results.map((result) => ({
          type: "geo",
          header: result?.placePrediction?.structuredFormat?.mainText?.text,
          description:
            result?.placePrediction?.structuredFormat?.secondaryText?.text,
          destination: {
            id: result?.placePrediction?.placeId,
            lat: null,
            lng: null,
            item: null,
            placeId: result?.placePrediction?.placeId,
          },
        })) ?? [],
      );
    });
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
    | F3LocationMapSearchResult
    | GeoMapSearchResult
    | F3RegionMapSearchResult
  )[];
} => {
  return useContext(TextSearchResultsContext);
};
