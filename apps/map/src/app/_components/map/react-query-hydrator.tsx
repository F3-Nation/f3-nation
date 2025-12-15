"use client";

import type { ReactNode } from "react";

import type { RouterOutputs } from "~/orpc/types";
import { orpc, useQuery } from "~/orpc/react";

/**
 * Hydrates the map event and location data on the client that were generated
 * with ssg.
 */
export const ReactQueryHydrator = (params: {
  eventsAndLocations: RouterOutputs["map"]["location"]["eventsAndLocations"];
  regionsWithLocation: RouterOutputs["map"]["location"]["regionsWithLocation"];
  children: ReactNode;
}) => {
  useQuery(
    orpc.map.location.eventsAndLocations.queryOptions({
      input: undefined,
      // hydrate via initialData to keep same behavior
      initialData: params.eventsAndLocations,
    }),
  );
  useQuery(
    orpc.map.location.regionsWithLocation.queryOptions({
      input: undefined,
      initialData: params.regionsWithLocation,
    }),
  );

  return <>{params.children}</>;
};
