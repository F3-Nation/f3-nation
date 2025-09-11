import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { mapStore } from "../store/map";
import { selectedItemStore } from "../store/selected-item";

export const useUpdateLocSearchParams = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const center = mapStore.use.center();
  const zoom = mapStore.use.zoom();
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const panelEventId = selectedItemStore.use.panelEventId();
  const lastCenter = useRef(center);

  // Update the search params when the panel is open
  useEffect(() => {
    if (
      center == null ||
      zoom == null ||
      panelLocationId != null ||
      panelEventId != null
    ) {
      return;
    }

    // If the center hasn't changed, don't update the search params
    if (
      center.lat === lastCenter.current.lat &&
      center.lng === lastCenter.current.lng
    ) {
      return;
    }
    lastCenter.current = center;

    const params = new URLSearchParams(searchParams?.toString());

    // Set the map position parameters
    params.set("lat", center.lat.toFixed(6));
    params.set("lng", center.lng.toFixed(6));
    params.set("zoom", zoom.toString());

    // Remove eventId and locationId parameters if they exist
    params.delete("eventId");
    params.delete("locationId");

    // Use router.replace to update URL without full page reload
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [center, panelEventId, panelLocationId, searchParams, router, zoom]);
};
