"use client";

import type { ReactNode } from "react";

import type { RouterOutputs } from "@acme/api";

import { api } from "~/trpc/react";

/**
 * Hydrates the map event and location data on the client that were generated
 * with ssg.
 */
export const ReactQueryHydrator = (params: {
  mapEventAndLocationData: RouterOutputs["location"]["getMapEventAndLocationData"];
  regionsWithLocationData: RouterOutputs["location"]["getRegionsWithLocation"];
  children: ReactNode;
}) => {
  api.location.getMapEventAndLocationData.useQuery(undefined, {
    initialData: params.mapEventAndLocationData,
  });
  api.location.getRegionsWithLocation.useQuery(undefined, {
    initialData: params.regionsWithLocationData,
  });

  return <>{params.children}</>;
};
