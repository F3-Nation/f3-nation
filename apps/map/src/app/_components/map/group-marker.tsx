import { useCallback } from "react";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";

import { Z_INDEX } from "@acme/shared/app/constants";
import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";
import { cn } from "@acme/ui";

import { groupMarkerClick } from "~/utils/actions/group-marker-click";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import {
  delayedDeselect,
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { useTouchDevice } from "~/utils/touch-device-provider";
import { useFilteredMapResults } from "../map/filtered-map-results-provider";
import { FeaturesClusterMarker } from "../marker-clusters/features-cluster-marker";

interface TreeMarkerProps {
  position: google.maps.LatLngLiteral;
  featureId: string;
  isClose: boolean;
  onMarkerClick?: (
    marker: google.maps.marker.AdvancedMarkerElement,
    featureId: string,
  ) => void;
}

export const FeatureMarker = ({
  position: _position,
  featureId,
  isClose,
}: TreeMarkerProps) => {
  const mode = appStore.use.mode();
  const { filteredLocationMarkers } = useFilteredMapResults();
  const selectedLocationId = selectedItemStore.use.locationId();
  const selectedEventId = selectedItemStore.use.eventId();
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const panelEventId = selectedItemStore.use.panelEventId();
  const { isTouchDevice: touchDevice } = useTouchDevice();
  const [markerRef] = useAdvancedMarkerRef();
  const id = Number(featureId);
  const modifiedLocation = mapStore.useBoundStore(
    (s) => s.modifiedLocationMarkers[id],
  );
  const position = modifiedLocation ?? _position;

  const events = filteredLocationMarkers?.find(
    (marker) => marker.id === id,
  )?.events;
  const isCurrentSelectedLocation = selectedLocationId === id;
  const isCurrentPanelLocation = panelLocationId === id;
  const noSelectedEvent = selectedEventId == null;
  const noSelectedPanelEvent = panelEventId == null;

  const handleClick = useCallback(
    ({ locationId, eventId }: { locationId: number; eventId?: number }) => {
      void groupMarkerClick({
        locationId,
        ...(eventId == null ? {} : { eventId }),
      });
    },
    [],
  );

  const handleHover = useCallback(
    ({ locationId, eventId }: { locationId: number; eventId?: number }) => {
      setSelectedItem({ locationId, eventId, showPanel: false });
    },
    [],
  );

  const handleDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      e.stop();
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();

      if (!lat || !lng) return;

      mapStore.setState({
        modifiedLocationMarkers: {
          ...mapStore.get("modifiedLocationMarkers"),
          [id]: { lat, lng },
        },
      });
    },
    [id],
  );

  return !events?.length ? null : !isClose ? (
    <FeaturesClusterMarker
      clusterId={id}
      position={position}
      size={1}
      sizeAsText={"1"}
      onMarkerClick={() => {
        const eventId = events.find(
          (event) => event.id === selectedEventId,
        )?.id;
        handleClick({
          locationId: id,
          eventId: eventId ?? events[0]?.id,
        });
      }}
    />
  ) : (
    <AdvancedMarker
      ref={markerRef}
      draggable={mode === "edit"}
      position={position}
      anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM}
      className={"marker feature"}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        // There are some places on the icon where the button is not clicked
        // but the marker is clicked (bottom left and right corners)
        // This is also necessary for mobile edit mode clicks
        const eventId = events.find(
          (event) => event.id === selectedEventId,
        )?.id;
        handleClick({
          locationId: id,
          eventId: eventId ?? events[0]?.id,
        });

        // Must call stop to prevent the map from being clicked
        e.stop();
      }}
      zIndex={
        isCurrentSelectedLocation
          ? Z_INDEX.SELECTED_MARKER
          : isCurrentPanelLocation
            ? Z_INDEX.PANEL_ITEM_MARKER
            : Z_INDEX.NON_HOVERED_MAP_MARKER
      }
    >
      <div className="relative flex flex-col">
        <div
          className={cn("flex flex-row rounded-full ring-[1px] ring-gray-700")}
          style={{ zIndex: 1, width: `${events.length * 30 + 4}px` }}
        >
          {events.map((event, eventIdx, eventArray) => {
            const isCurrentPanelLocation = panelLocationId === id;
            const isCurrentPanelEvent = panelEventId === event.id;
            const isCurrentSelectedEvent = selectedEventId === event.id;
            const dotw = event.dayOfWeek;
            const isStart = eventIdx === 0;
            const isEnd = eventIdx === eventArray.length - 1;
            const dayText = dotw ? dayOfWeekToShortDayOfWeek(dotw) : " ";
            return (
              <button
                key={id + "-" + event.id}
                onClick={(e) => {
                  handleClick({ locationId: id, eventId: event.id });
                  e.stopPropagation();
                }}
                onMouseEnter={(e) => {
                  handleHover({ locationId: id, eventId: event.id });
                  e.stopPropagation();
                }}
                onMouseLeave={(e) => {
                  delayedDeselect();
                  e.stopPropagation();
                }}
                className={cn(
                  // min-h-[32.5px] so it doesn't collapse with no text
                  "min-h-[32.5px] flex-1 cursor-pointer bg-foreground py-2 text-center text-background",
                  "border-b-2 border-l-2 border-r-2 border-t-2 border-foreground ",
                  `google-eventid-${event.id}`,
                  {
                    "rounded-r-full": isEnd,
                    "rounded-l-full": isStart,
                    "border-red-600 dark:border-red-400":
                      isCurrentSelectedEvent ||
                      (isCurrentSelectedLocation && noSelectedEvent),
                    "border-red-600 bg-red-600 font-bold dark:bg-red-400":
                      // On mobile we always use the background
                      (touchDevice && isCurrentSelectedEvent) ||
                      isCurrentPanelEvent ||
                      (isCurrentPanelLocation && noSelectedPanelEvent),
                  },
                )}
              >
                {dayText}
              </button>
            );
          })}
        </div>
        <svg
          viewBox="0 0 40 40"
          className="-mt-[10.5px] w-[28px] self-center"
          style={{ zIndex: 0 }}
        >
          <path
            className={cn("fill-foreground", {
              "fill-[#dc2626] dark:fill-[#f87171]": false,
            })}
            d={
              events.length === 1
                ? "M34 10 L26 24.249 Q20 34.641 14 24.249 L6 10"
                : "M34 14.5 L26 24.249 Q20 34.641 14 24.249 L6 14.5"
            }
            stroke="none"
          />
          <path
            d={
              events.length === 1
                ? "M34 10 L26 24.249 Q20 34.641 14 24.249 L6 10"
                : "M34 15 L26 24.249 Q20 34.641 14 24.249 L6 15"
            }
            stroke="background"
            strokeWidth={0.5}
            fill="none"
          />
        </svg>
      </div>
    </AdvancedMarker>
  );
};
