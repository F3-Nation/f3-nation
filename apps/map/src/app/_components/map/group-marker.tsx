import { useCallback } from "react";
import {
  AdvancedMarker,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { toast } from "@acme/ui/toast";

import { groupMarkerClick } from "~/utils/actions/group-marker-click";
import type { MapStatus } from "~/utils/types";
import { dayLabelSegments } from "~/utils/day-label-segments";
import {
  getDominantStatus,
  getStatusSolidBg,
  getStatusTextColor,
} from "~/utils/map-status-colors";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import {
  delayedDeselect,
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { useTouchDevice } from "~/utils/touch-device-provider";
import { useFilteredMapResults } from "../map/filtered-map-results-provider";

interface TreeMarkerProps {
  position: google.maps.LatLngLiteral;
  featureId: string;
  /** From DAY_LABEL_ZOOM up the pin shows its workout days. */
  showDayLabels: boolean;
  onMarkerClick?: (
    marker: google.maps.marker.AdvancedMarkerElement,
    featureId: string,
  ) => void;
}

export const FeatureMarker = ({
  position: _position,
  featureId,
  showDayLabels,
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

      if (lat == null || lng == null) return;

      mapStore.setState({
        modifiedLocationMarkers: {
          ...mapStore.get("modifiedLocationMarkers"),
          [id]: { lat, lng },
        },
      });

      toast.success(
        'Marker moved! Latitude and longitude updated in draft. Click "Edit AO" → "Edit AO details" and Save to persist these changes to the database.',
        { duration: 10000 },
      );
    },
    [id],
  );

  const dominantStatus = events?.length ? getDominantStatus(events) : null;
  const segments = dayLabelSegments(events ?? []);
  // The location open in the panel is drawn outlined and raised.
  const isRaised =
    isCurrentPanelLocation || (touchDevice && isCurrentSelectedLocation);

  const clickLocation = () => {
    const eventId = events?.find((event) => event.id === selectedEventId)?.id;
    handleClick({
      locationId: id,
      eventId: eventId ?? events?.[0]?.id,
    });
  };

  if (!events?.length) return null;

  if (!showDayLabels) {
    return (
      <AdvancedMarker
        position={position}
        anchorLeft="-50%"
        anchorTop="-100%"
        className="marker feature"
        draggable={mode === "edit"}
        onDragEnd={handleDragEnd}
        zIndex={
          isCurrentSelectedLocation || isCurrentPanelLocation
            ? Z_INDEX.SELECTED_MARKER
            : Z_INDEX.NON_HOVERED_MAP_MARKER
        }
        onClick={(e) => {
          clickLocation();
          // Must call stop to prevent the map from being clicked
          e.stop();
        }}
      >
        <PinShape
          aria-label={events[0]?.aoName ?? "Workout location"}
          status={dominantStatus}
          className={cn(
            "w-[18px] cursor-pointer drop-shadow-sm transition-transform",
            (isRaised || isCurrentSelectedLocation) && "scale-125",
          )}
        />
      </AdvancedMarker>
    );
  }

  return (
    <AdvancedMarker
      ref={markerRef}
      draggable={mode === "edit"}
      position={position}
      anchorLeft="-50%"
      anchorTop="-100%"
      className={"marker feature"}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        // There are some places on the icon where the button is not clicked
        // but the marker is clicked (bottom left and right corners)
        // This is also necessary for mobile edit mode clicks
        clickLocation();

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
      <div
        className={cn(
          "relative flex flex-col items-center transition-transform",
          isRaised && "-translate-y-1 scale-110",
        )}
      >
        <div
          className={cn(
            "flex flex-row overflow-hidden rounded-full bg-primary shadow-md",
            isRaised
              ? "shadow-xl ring-2 ring-white dark:ring-white"
              : isCurrentSelectedLocation
                ? "ring-2 ring-foreground/70"
                : "ring-1 ring-black/30",
          )}
          style={{ zIndex: 1 }}
        >
          {segments.map((segment, index) => {
            const isCurrentPanelEvent =
              panelEventId != null && segment.eventIds.includes(panelEventId);
            const isCurrentSelectedEvent =
              selectedEventId != null &&
              segment.eventIds.includes(selectedEventId);
            const segmentEventId =
              (isCurrentSelectedEvent ? selectedEventId : null) ??
              segment.eventIds[0];
            return (
              <button
                key={`${id}-${segment.day ?? "none"}`}
                onClick={(e) => {
                  handleClick({ locationId: id, eventId: segmentEventId });
                  e.stopPropagation();
                }}
                onMouseEnter={(e) => {
                  handleHover({ locationId: id, eventId: segmentEventId });
                  e.stopPropagation();
                }}
                onMouseLeave={(e) => {
                  delayedDeselect();
                  e.stopPropagation();
                }}
                className={cn(
                  "min-w-[26px] cursor-pointer px-1.5 py-1.5 text-center text-xs leading-none font-bold text-white",
                  segment.status
                    ? getStatusSolidBg(segment.status)
                    : "hover:bg-primary-hover bg-primary",
                  index > 0 && "border-l border-black/15",
                  `google-eventid-${segment.eventIds[0]}`,
                  (isCurrentPanelEvent ||
                    (touchDevice && isCurrentSelectedEvent)) &&
                    "underline decoration-2 underline-offset-2",
                )}
              >
                {segment.label}
              </button>
            );
          })}
        </div>
        <svg
          viewBox="0 0 12 8"
          aria-hidden
          className={cn(
            "-mt-px w-3",
            dominantStatus
              ? getStatusTextColor(dominantStatus)
              : "text-primary",
          )}
          style={{ zIndex: 0 }}
        >
          <path d="M0 0 L12 0 L6 8 Z" fill="currentColor" />
        </svg>
      </div>
    </AdvancedMarker>
  );
};

/** A plain map pin in F3 red, or the location's status color. */
const PinShape = ({
  status,
  className,
  ...rest
}: {
  status: MapStatus;
  className?: string;
  "aria-label"?: string;
}) => (
  <svg
    viewBox="0 0 24 32"
    role="img"
    className={cn(
      status ? getStatusTextColor(status) : "text-primary",
      className,
    )}
    {...rest}
  >
    <path
      d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0Z"
      fill="currentColor"
      stroke="rgba(0,0,0,0.35)"
      strokeWidth={1}
    />
    <circle cx="12" cy="11.5" r="4" fill="white" />
  </svg>
);
