import { CLOSE_ZOOM } from "@acme/shared/app/constants";
import { isDevelopment } from "@acme/shared/common/constants";

import { mapStore } from "./store/map";

export const setView = (params: {
  lat: number;
  lng: number;
  zoom?: number;
  options?: { animate?: boolean; onlyIfNotMovedMap?: boolean };
  isRetry?: boolean;
}) => {
  if (isDevelopment) {
    const stackTrace = new Error().stack;
    const callerInfo =
      stackTrace?.split("\n")[2]?.trim().split("/").slice(-1)[0] ??
      "Unknown caller";
    console.log(
      "setView called by:",
      callerInfo,
      params,
      !!mapStore.get("map"),
    );
  }

  if (params.options?.onlyIfNotMovedMap && mapStore.get("hasMovedMap")) {
    console.log("Not redirecting because we've moved the map");
    return;
  }

  const map = mapStore.get("map");
  if (!map && !params.isRetry) {
    console.log("Map not initialized, trying again in 2 seconds");
    setTimeout(() => {
      setView({ ...params, isRetry: true });
    }, 2000);
    return;
  }

  // Workout details open in the left panel, beside the map rather than over
  // it, so the location is centered as-is.
  const center = { lat: params.lat, lng: params.lng };
  const newZoom = params.zoom ?? Math.max(mapStore.get("zoom"), CLOSE_ZOOM);

  mapStore.setState({
    hasMovedMap: true,
    zoom: newZoom,
    center,
    nearbyLocationCenter: {
      ...center,
      name: null,
      type: "manual-update",
    },
  });
  map?.setZoom(newZoom);
  map?.setCenter(center);
};
