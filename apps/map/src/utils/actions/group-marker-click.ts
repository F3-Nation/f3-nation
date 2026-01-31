import { orpc } from "~/orpc/react";
import {
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { isTouchDevice } from "../is-touch-device";
import { setView } from "../set-view";
import { mapStore } from "../store/map";

export const groupMarkerClick = async ({
  locationId,
  eventId,
}: {
  locationId: number;
  eventId?: number;
}) => {
  const touchDevice = isTouchDevice();
  const isAlreadySelected =
    selectedItemStore.get("locationId") === locationId &&
    selectedItemStore.get("eventId") === eventId;
  const result = await orpc.map.location.locationWorkout.call({
    locationId,
  });
  if (!result?.location) return;

  const modifiedLocation = mapStore.get("modifiedLocationMarkers")[locationId];

  const lat = modifiedLocation?.lat ?? result.location.lat;
  const lon = modifiedLocation?.lng ?? result.location.lon;
  if (lat === null || lon === null) return;

  setSelectedItem({
    locationId,
    eventId,
    showPanel: !touchDevice || isAlreadySelected,
  });
  setView({ lat, lng: lon, zoom: 15 });
};
