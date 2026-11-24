"use client";

import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef } from "react";

import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { TestId } from "@acme/shared/common/enums";
import { cn } from "@acme/ui";

import { latLngToMeters } from "~/utils/lat-lng-to-meters";
import { filterStore, isAnyFilterActive } from "~/utils/store/filter";
import { mapStore } from "~/utils/store/map";
import { DesktopNearbyLocationItemSkeleton } from "./desktop-nearby-location-item-skeleton";
import { useFilteredMapResults } from "./filtered-map-results-provider";
import { NearbyLocationItem } from "./nearby-location-item";
import WithLove from "./with-love";

export const DesktopNearbyLocations = ({
  className,
  ...rest
}: ComponentProps<"div">) => {
  RERENDER_LOGS && console.log("DrawerSearchResults rerender");
  const filters = filterStore.useBoundStore();
  const { aoGroupedLocationMarkers, nearbyLocationCenter } =
    useFilteredMapResults();
  const nearbyLocationScrollRef = useRef<HTMLDivElement>(null);
  const center = mapStore.use.center();

  const hasMovedAwayFromLocation = useMemo(() => {
    return (
      latLngToMeters(
        center.lat,
        center.lng,
        nearbyLocationCenter?.lat,
        nearbyLocationCenter?.lng,
      ) > 1000
    ); // one km
  }, [center, nearbyLocationCenter]);

  // Scroll to the top of the nearby locations when the nearby location center changes
  useEffect(() => {
    if (nearbyLocationScrollRef.current) {
      nearbyLocationScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [nearbyLocationCenter]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} {...rest}>
      <div className="flex flex-row items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="bg-primary px-3 py-1 text-[11px] font-bold tracking-wider text-primary-foreground uppercase [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]">
          Nearby workouts
        </h2>
        <div className="flex flex-row items-center gap-2 text-[11px] text-muted-foreground">
          {hasMovedAwayFromLocation ? (
            <button
              className="font-semibold text-foreground underline underline-offset-2"
              onClick={() => {
                mapStore.setState({
                  nearbyLocationCenter: {
                    ...center,
                    type: "manual-update",
                    name: null,
                  },
                });
              }}
            >
              Update
            </button>
          ) : null}
          <span>Closest first</span>
        </div>
      </div>
      <NearbyLocationContent nearbyLocationCenter={nearbyLocationCenter} />
      <div
        className="flex flex-1 flex-col overflow-y-auto border-t"
        ref={nearbyLocationScrollRef}
      >
        <div
          className="flex flex-col justify-center divide-y divide-solid"
          data-testid={TestId.NEARBY_LOCATIONS}
        >
          {!aoGroupedLocationMarkers ? (
            Array.from({ length: 6 }).map((_, index) => (
              <DesktopNearbyLocationItemSkeleton key={index} />
            ))
          ) : aoGroupedLocationMarkers.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No locations found{" "}
              {isAnyFilterActive(filters) ? "matching your filters" : ""}
            </div>
          ) : (
            aoGroupedLocationMarkers
              .slice(0, 20)
              .map((result) => (
                <NearbyLocationItem key={result.aoId} item={result} />
              ))
          )}
        </div>
      </div>
      <WithLove />
    </div>
  );
};

const NearbyLocationContent = ({
  nearbyLocationCenter,
}: {
  nearbyLocationCenter: ReturnType<typeof mapStore.use.nearbyLocationCenter>;
}) => {
  if (!nearbyLocationCenter)
    return (
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        Loading nearby workouts…
      </p>
    );

  if (!nearbyLocationCenter.name) return null;

  return (
    <p className="line-clamp-1 px-4 pb-2 text-xs text-muted-foreground">
      Near{" "}
      <span className="font-semibold text-foreground">
        {nearbyLocationCenter.name}
      </span>
    </p>
  );
};
