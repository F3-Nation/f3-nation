"use client";

import { useEffect, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import debounce from "lodash/debounce";

import {
  SELECTED_ITEM_DEBOUNCE_TIME_MS,
  Z_INDEX,
} from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

import { getQueryClient, orpc } from "~/orpc/react";
import { mapStore } from "~/utils/store/map";
import { selectedItemStore } from "~/utils/store/selected-item";
import { SelectedItem } from "./selected-item";
import { useSelectedItem } from "./use-selected-item";

const SelectedItemWrapper = () => {
  const hideSelectedItem = selectedItemStore.use.hideSelectedItem();
  const mapEvent = mapStore.use.event();
  const selectedItem = useSelectedItem();

  const [debouncedSelectedItem, setDebouncedSelectedItem] = useState<
    typeof selectedItem | undefined
  >(selectedItem);

  // Create memoized debounced function
  const debouncedSetSelectedItem = useMemo(
    () =>
      debounce((newPosition: typeof selectedItem) => {
        setDebouncedSelectedItem(cloneDeep(newPosition));
      }, SELECTED_ITEM_DEBOUNCE_TIME_MS),
    [],
  );

  // // Update debounced position when pagePosition changes
  useEffect(() => {
    if (mapEvent !== "idle" || selectedItem.selectedLocation?.id == null) {
      setDebouncedSelectedItem(undefined);
      return;
    } else if (typeof selectedItem.selectedLocation?.id === "number") {
      void getQueryClient().prefetchQuery(
        orpc.location.getLocationWorkoutData.queryOptions({
          input: { locationId: selectedItem.selectedLocation?.id },
        }),
      );
    }

    debouncedSetSelectedItem(selectedItem);

    // Cleanup
    return () => {
      debouncedSetSelectedItem.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedItem object doesn't change but the properties do
  }, [
    selectedItem.selectedLocation,
    selectedItem.selectedEvent,
    debouncedSetSelectedItem,
    mapEvent,
  ]);

  if (
    !debouncedSelectedItem?.selectedLocation ||
    !debouncedSelectedItem?.selectedEvent ||
    mapEvent !== "idle"
  ) {
    return null;
  }

  return (
    <div
      className={cn("absolute hidden lg:block", {
        "lg:hidden": hideSelectedItem,
      })}
      style={{
        zIndex: Z_INDEX.SELECTED_ITEM_CONTAINER_DESKTOP,
        top: debouncedSelectedItem.pagePosition?.y,
        left: debouncedSelectedItem.pagePosition?.x,
        transform: "translate(-50%, 5px)",
      }}
    >
      <SelectedItem
        device="desktop"
        selectedLocation={debouncedSelectedItem.selectedLocation}
        selectedEvent={debouncedSelectedItem.selectedEvent}
        hideCloseButton
      />
    </div>
  );
};

export default SelectedItemWrapper;
