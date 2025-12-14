import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { ArrowDownToDot, MapPin, MapPinPlusInside, X } from "lucide-react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import { orpc, useQuery } from "~/orpc/react";
import { openRequestModal } from "~/utils/open-request-modal";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import { useFilteredMapResults } from "./filtered-map-results-provider";

export const UpdatePane = () => {
  const updateLocation = mapStore.use.updateLocation();
  const { locationOrderedLocationMarkers } = useFilteredMapResults();
  const mode = appStore.use.mode();

  const { data: workoutInfo } = useQuery(
    orpc.location.getLocationWorkoutData.queryOptions({
      input: { locationId: locationOrderedLocationMarkers?.[0]?.id ?? -1 },
      enabled: mode === "edit" && !!locationOrderedLocationMarkers?.[0]?.id,
    }),
  );

  // Function to clear the update location pin
  const clearUpdateLocation = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    mapStore.setState({ updateLocation: null });
  };

  // Create new location with new AO and event
  const handleCreateNew = async () => {
    if (!updateLocation) {
      toast.error("New location marker not found");
      return;
    }

    void openRequestModal({
      type: "create_ao_and_location_and_event",
      meta: { originalRegionId: workoutInfo?.location.regionId },
    });
  };

  // Move existing AO to this location
  const handleMoveAO = () => {
    if (!updateLocation) {
      toast.error("New location marker not found");
      return;
    }

    void openRequestModal({
      type: "move_ao_to_new_location",
      meta: {
        originalRegionId: workoutInfo?.location.regionId,
        originalAoId: workoutInfo?.location.events[0]?.aoId ?? undefined,
        originalLocationId: workoutInfo?.location.id ?? undefined,
      },
    });
  };

  // Move existing event to new AO here
  const handleMoveEvent = () => {
    if (!updateLocation) {
      toast.error("New location marker not found");
      return;
    }

    void openRequestModal({
      type: "move_event_to_new_location",
      meta: {
        originalRegionId: workoutInfo?.location.regionId ?? undefined,
        originalAoId: workoutInfo?.location.events[0]?.aoId ?? undefined,
        originalLocationId: workoutInfo?.location.id ?? undefined,
      },
    });
  };

  if (!updateLocation || mode !== "edit") return null;

  return (
    <AdvancedMarker
      zIndex={Z_INDEX.UPDATE_PANE}
      draggable
      onDragEnd={(e) => {
        if (!e.latLng) throw new Error("No latLng");
        mapStore.setState({
          updateLocation: {
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
          },
        });
      }}
      position={updateLocation}
    >
      <div className="relative size-8">
        <MapPinPlusInside
          data-testid={TestId.UPDATE_PANE_MARKER}
          className="absolute size-8 fill-blue-500 text-foreground dark:fill-blue-600"
        />
        <div
          className="absolute top-[110%] z-50"
          style={{
            left: "50%",
            bottom: "20px",
            transform: "translateX(-50%)",
          }}
        >
          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <Button
              variant="outline"
              size="sm"
              className="grid grid-cols-[20px_1fr] border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600 hover:text-white"
              onClick={handleCreateNew}
              onTouchEnd={handleCreateNew}
            >
              <MapPin className="h-4 w-4" />
              New location, AO, & event
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="grid grid-cols-[20px_1fr] border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600 hover:text-white"
              onClick={handleMoveAO}
              onTouchEnd={handleMoveAO}
            >
              <ArrowDownToDot className="h-4 w-4" />
              Move existing AO here
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="grid grid-cols-[20px_1fr] border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600 hover:text-white"
              onClick={handleMoveEvent}
              onTouchEnd={handleMoveEvent}
            >
              <ArrowDownToDot className="h-4 w-4" />
              Move existing event here
            </Button>
          </div>

          <div className="mt-2">
            <button
              className="absolute -right-2 -top-2 rounded-full bg-muted-foreground px-1 py-1 text-sm text-background"
              onClick={clearUpdateLocation}
              onTouchEnd={clearUpdateLocation}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </AdvancedMarker>
  );
};
