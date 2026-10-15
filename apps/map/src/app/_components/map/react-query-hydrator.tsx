"use client";

import type { ReactNode } from "react";

import { MAP_DATASET_STALE_TIME_MS } from "~/orpc/query-client";
import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";

/**
 * Hydrates the map event and location data on the client that were generated
 * with ssg.
 */
export const ReactQueryHydrator = (params: {
  eventsAndLocations: RouterOutputs["map"]["location"]["eventsAndLocations"];
  regionsWithLocation: RouterOutputs["map"]["location"]["regionsWithLocation"];
  /** When the server render fetched the data above (ms since epoch). */
  dataFetchedAt: number;
  children: ReactNode;
}) => {
  // Only hydrate when real data exists — empty arrays (from SKIP_SSG builds)
  // would be treated as fresh by React Query, preventing the client fetch.
  const hasEvents = params.eventsAndLocations.length > 0;
  const hasRegions = params.regionsWithLocation.regionsWithLocation.length > 0;

  useQuery(
    orpc.map.location.eventsAndLocations.queryOptions({
      input: undefined,
      staleTime: MAP_DATASET_STALE_TIME_MS,
      // Stamp the SSG/ISR copy with when it was actually fetched: a fresh
      // render is used as is, and one older than staleTime (an ISR page can be
      // served for up to an hour) refetches once on mount.
      ...(hasEvents
        ? {
            initialData: params.eventsAndLocations,
            initialDataUpdatedAt: params.dataFetchedAt,
          }
        : {}),
    }),
  );
  useQuery(
    orpc.map.location.regionsWithLocation.queryOptions({
      input: undefined,
      staleTime: MAP_DATASET_STALE_TIME_MS,
      ...(hasRegions
        ? {
            initialData: params.regionsWithLocation,
            initialDataUpdatedAt: params.dataFetchedAt,
          }
        : {}),
    }),
  );

  return <>{params.children}</>;
};
