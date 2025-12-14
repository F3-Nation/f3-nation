import { useMemo } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Spinner } from "@acme/ui/spinner";

import { latLngToMeters } from "~/utils/lat-lng-to-meters";
import { mapStore } from "~/utils/store/map";
import { useUserLocation } from "./user-location-provider";

export const NearbyLocationUpdateButton = () => {
  const center = mapStore.use.center();
  const nearbyLocationCenter = mapStore.use.nearbyLocationCenter();
  const { status } = useUserLocation();
  // If the center is more than 100 meters away from the nearbyLocationCenter, then we have moved away from the location
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
  return status === "loading" ? (
    <div
      className={cn(
        "rounded-xl bg-background px-4 py-1 text-sm text-foreground shadow",
        "absolute left-2/4 top-14 -translate-x-2/4",
      )}
    >
      <div className="flex flex-row items-center gap-2">
        <Spinner className="h-4 w-4" />
        <p>Loading your location...</p>
      </div>
    </div>
  ) : hasMovedAwayFromLocation ? (
    <button
      className={cn(
        "rounded-xl bg-background px-4 py-1 text-sm text-foreground shadow",
        "absolute left-2/4 top-14 -translate-x-2/4",
      )}
      style={{ zIndex: Z_INDEX.OVERLAY_BUTTONS }}
      onClick={() => {
        const center = mapStore.get("center");
        if (!center) return;
        mapStore.setState({
          nearbyLocationCenter: {
            ...center,
            name: null,
            type: "manual-update",
          },
        });
      }}
    >
      Show nearby areas
    </button>
  ) : null;
};
