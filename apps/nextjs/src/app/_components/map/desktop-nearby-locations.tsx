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
  const { locationOrderedLocationMarkers, nearbyLocationCenter } =
    useFilteredMapResults();
  const nearbyLocationScrollRef = useRef<HTMLDivElement>(null);
  const center = mapStore.use.center();

  const hasMovedAwayFromLocation = useMemo(() => {
    return (
      latLngToMeters(
        center?.lat,
        center?.lng,
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
    <>
      <div className="flex flex-row justify-center py-2">
        <NearbyLocationContent nearbyLocationCenter={nearbyLocationCenter} />
        {hasMovedAwayFromLocation && center && (
          <button
            className="ml-2 self-end text-sm text-foreground underline"
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
        )}
      </div>
      <div
        className={cn("flex flex-1 flex-col overflow-y-scroll", className)}
        ref={nearbyLocationScrollRef}
        {...rest}
      >
        <div
          className="flex flex-col justify-center divide-y divide-solid"
          data-testid={TestId.NEARBY_LOCATIONS}
        >
          {!locationOrderedLocationMarkers ? (
            Array.from({ length: 6 }).map((_, index) => (
              <DesktopNearbyLocationItemSkeleton key={index} />
            ))
          ) : locationOrderedLocationMarkers.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No locations found{" "}
              {isAnyFilterActive(filters) ? "matching your filters" : ""}
            </div>
          ) : (
            locationOrderedLocationMarkers
              .slice(0, 20)
              .map((result) => (
                <NearbyLocationItem key={result.id} item={result} />
              ))
          )}
        </div>
      </div>
      <WithLove />
    </>
  );
};

const NearbyLocationContent = ({
  nearbyLocationCenter,
}: {
  nearbyLocationCenter: ReturnType<typeof mapStore.use.nearbyLocationCenter>;
}) => {
  if (!nearbyLocationCenter)
    return (
      <div className="text-center text-sm">Loading nearby locations...</div>
    );

  if (!nearbyLocationCenter.name)
    return <div className="text-center text-sm">Nearby locations</div>;

  return (
    <div className="text-center text-sm">
      Locations near <b>{nearbyLocationCenter.name}</b>
    </div>
  );
};
