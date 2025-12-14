"use client";

import { Z_INDEX } from "@acme/shared/app/constants";

import { SelectedItem } from "./selected-item";
import { SelectedItemSkeleton } from "./selected-item-skeleton";
import { useSelectedItem } from "./use-selected-item";

export const MobileSelectedItem = () => {
  const { selectedLocation, selectedEvent, locationId, eventId } =
    useSelectedItem();

  // Timer that will alternate true and false for a state variable every second

  return locationId === null || eventId === null ? null : (
    <div
      style={{ zIndex: Z_INDEX.SELECTED_ITEM_CONTAINER_DESKTOP }}
      className="mb-2 px-2 pt-0"
    >
      {!selectedLocation || !selectedEvent ? (
        <SelectedItemSkeleton />
      ) : (
        <SelectedItem
          device="mobile"
          selectedLocation={selectedLocation}
          selectedEvent={selectedEvent}
          hideCloseButton
        />
      )}
    </div>
  );
};
