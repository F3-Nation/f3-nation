"use client";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

import { orpc, useQuery } from "~/orpc/react";
import { mapStore } from "~/utils/store/map";
import { useFilteredMapResults } from "./filtered-map-results-provider";

export const DebugInfo = () => {
  const zoom = mapStore.use.zoom();
  const center = mapStore.use.center();
  const { data: workoutCount } = useQuery(
    orpc.map.location.workoutCount.queryOptions(),
  );
  const { filteredLocationMarkers } = useFilteredMapResults();

  return (
    <div
      style={{ zIndex: Z_INDEX.DEBUG_INFO }}
      className={cn(
        `absolute right-0 top-48 h-min bg-foreground/10 p-2 lg:bottom-0 lg:right-0`,
      )}
    >
      <div className="m-0 p-0">Zoom: {zoom?.toFixed(1)}</div>
      <div className="m-0 p-0">
        Center: {center?.lat.toFixed(5)}, {center?.lng.toFixed(5)}
      </div>
      <div className="m-0 p-0">Workouts: {workoutCount?.count}</div>
      <div className="m-0 p-0">
        Locations: {filteredLocationMarkers?.length}
      </div>
    </div>
  );
};
