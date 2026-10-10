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
      // The SSG/ISR copy can be up to an hour old: treat it as stale so the
      // first mount still fetches once (as before); only repeat fetches stop.
      ...(hasEvents
        ? { initialData: params.eventsAndLocations, initialDataUpdatedAt: 0 }
        : {}),
    }),
  );
  useQuery(
    orpc.map.location.regionsWithLocation.queryOptions({
      input: undefined,
      staleTime: MAP_DATASET_STALE_TIME_MS,
      ...(hasRegions
        ? { initialData: params.regionsWithLocation, initialDataUpdatedAt: 0 }
        : {}),
    }),
  );

  return <>{params.children}</>;
};
