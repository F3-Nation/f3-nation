"use client";

import type { ReactNode } from "react";

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
      ...(hasEvents ? { initialData: params.eventsAndLocations } : {}),
    }),
  );
  useQuery(
    orpc.map.location.regionsWithLocation.queryOptions({
      input: undefined,
      ...(hasRegions ? { initialData: params.regionsWithLocation } : {}),
    }),
  );

  return <>{params.children}</>;
};
