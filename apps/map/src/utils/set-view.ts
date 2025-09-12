import { CLOSE_ZOOM } from "@acme/shared/app/constants";
import { isDevelopment } from "@acme/shared/common/constants";

import { isTouchDevice } from "./is-touch-device";
import { mapStore } from "./store/map";
import { modalStore, ModalType } from "./store/modal";

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

  const touchDevice = isTouchDevice();
  const [openModal] = modalStore.get("modals").slice(-1);
  const type = openModal?.type;
  const workoutModalOpen = openModal && type === ModalType.WORKOUT_DETAILS;
  let center = { lat: params.lat, lng: params.lng };
  const newZoom = params.zoom ?? Math.max(mapStore.get("zoom"), CLOSE_ZOOM);

  if (!touchDevice && workoutModalOpen && map) {
    // 0.008 corresponds to about 100px at this zoom level
    center = { lat: params.lat, lng: params.lng - 0.008 };
  }

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
