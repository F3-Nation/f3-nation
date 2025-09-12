import { ZustandStore } from "@acme/shared/common/classes";
import { isDevelopment } from "@acme/shared/common/constants";

import { queryClientUtils } from "~/trpc/react";
import { appStore } from "./app";
import { ModalType, openModal } from "./modal";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SelectedItemStore = {
  locationId: number | null;
  eventId: number | null;
  hideSelectedItem: boolean;
  panelLocationId: number | null;
  panelEventId: number | null;
  isEditDragging: boolean;
  pendingDeselectId: number;
};

// TODO Rename to hoveredItemStore
export const selectedItemStore = new ZustandStore<SelectedItemStore>({
  initialState: {
    locationId: null,
    eventId: null,
    hideSelectedItem: false,
    panelLocationId: null,
    panelEventId: null,
    isEditDragging: false,
    pendingDeselectId: 0,
  },
  persistOptions: {
    name: "selected-item-store",
    persistedKeys: [],
    version: 1,
    getStorage: () => localStorage,
  },
});

// Used to prevent deselecting the item when the user is dragging the map
const incrementPendingDeselectId = () => {
  selectedItemStore.setState({
    pendingDeselectId: selectedItemStore.getState().pendingDeselectId + 1,
  });
};

export const hideSelectedItem = () => {
  selectedItemStore.setState({ hideSelectedItem: true });
};

export const clearSelectedItem = () => {
  if (isDevelopment) {
    const stackTrace = new Error().stack;
    const callerInfo =
      stackTrace?.split("\n")[2]?.trim().split("/").slice(-1)[0] ??
      "Unknown caller";
    console.log("clearSelectedItem called by:", callerInfo);
  }
  selectedItemStore.setState({
    locationId: null,
    eventId: null,
    // Don't clear pagePosition so we can reuse it
  });
};

/**
 * if a value is undefined then ignore it
 * null means set it to null
 * number means set it to the number
 */
export const setSelectedItem = (item: {
  locationId?: number | null;
  eventId?: number | null;
  showPanel: boolean;
}) => {
  incrementPendingDeselectId();
  // Get caller information from stack trace
  if (isDevelopment) {
    const stackTrace = new Error().stack;
    const callerInfo =
      stackTrace?.split("\n")[2]?.trim().split("/").slice(-1)[0] ??
      "Unknown caller";
    console.log("setSelectedItem called by:", callerInfo, "with params:", item);
  }

  const currentSelectedItemStore = selectedItemStore.getState();
  const currentLocationId = currentSelectedItemStore.locationId;
  const currentEventId = currentSelectedItemStore.eventId;

  const isMobileDeviceWidth = appStore.get("isMobileDeviceWidth");
  const newSelectedItemStore: Partial<SelectedItemStore> = {
    hideSelectedItem: false,
  };

  // Can be null or a value | undefined means use the current value
  newSelectedItemStore.locationId =
    item.locationId === undefined ? currentLocationId : item.locationId;
  newSelectedItemStore.eventId =
    item.eventId === undefined ? currentEventId : item.eventId;

  // Update selected item always
  if (
    newSelectedItemStore.locationId !== null &&
    newSelectedItemStore.eventId == null
  ) {
    const dataArray = queryClientUtils.location.getMapEventAndLocationData
      .getData()
      ?.find((location) => location[0] === item.locationId);
    const events = dataArray?.[6];
    newSelectedItemStore.eventId = events?.[0]?.[0] ?? null;
  }

  if (isMobileDeviceWidth) {
    // on mobile width always have panelIds as null
    newSelectedItemStore.panelLocationId = null;
    newSelectedItemStore.panelEventId = null;
  } else if (item.showPanel) {
    // on desktop show panel if showPanel is true
    newSelectedItemStore.hideSelectedItem = true;
    newSelectedItemStore.panelLocationId =
      newSelectedItemStore.locationId === undefined
        ? currentLocationId
        : newSelectedItemStore.locationId;
    newSelectedItemStore.panelEventId =
      newSelectedItemStore.eventId === undefined
        ? currentEventId
        : newSelectedItemStore.eventId;
  }

  selectedItemStore.setState(newSelectedItemStore);

  if (item.showPanel) {
    openModal(ModalType.WORKOUT_DETAILS, {
      locationId: item.locationId,
      eventId: item.eventId,
    });
  }
};

export const closePanel = () => {
  console.log("closePanel");
  selectedItemStore.setState({
    panelLocationId: null,
    panelEventId: null,
  });
};

export const delayedDeselect = () => {
  const currentSelectedItem = selectedItemStore.getState();
  const currentPendingDeselectId = selectedItemStore.get("pendingDeselectId");
  setTimeout(() => {
    const selectedItem = selectedItemStore.getState();
    if (
      currentSelectedItem.locationId === selectedItem.locationId &&
      currentSelectedItem.eventId === selectedItem.eventId &&
      currentPendingDeselectId === selectedItemStore.get("pendingDeselectId")
    ) {
      setSelectedItem({
        locationId: null,
        eventId: null,
        showPanel: false,
      });
    }
  }, 500);
};
