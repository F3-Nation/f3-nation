import { useWindowWidth } from "@react-hook/window-size";
import { X } from "lucide-react";

import { BreakPoints } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";

import { orpc, useQuery } from "~/orpc/react";
import { appStore } from "~/utils/store/app";
import { closePanel, selectedItemStore } from "~/utils/store/selected-item";
import { WorkoutDetailsContent } from "../workout/workout-details-content";
import {
  formatTime,
  getShortDayOfWeek,
  isInstanceEventId,
  LocationEditButtons,
  resolveAoId,
} from "./location-edit-buttons";

export const DesktopLocationPanelContent = () => {
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const panelEventId = selectedItemStore.use.panelEventId();
  const width = useWindowWidth();
  const isLarge = width > Number(BreakPoints.LG);
  const isMedium = width > Number(BreakPoints.MD);
  const mode = appStore.use.mode();

  // Get location data including events
  const { data: locationData } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId: panelLocationId ?? -1 },
      enabled: panelLocationId !== null,
    }),
  );

  // Get AO name and selected event name
  const aoName = locationData?.location?.parentName ?? "AO";
  const selectedEvent = locationData?.location?.events.find(
    (event) => event.id === panelEventId,
  );
  const modalAOIds = locationData?.location?.events.map((e) => e.aoId);
  const aoId = resolveAoId({
    selectedEventAoId: selectedEvent?.aoId,
    eventAoIds: modalAOIds,
  });
  const eventName = selectedEvent?.name ?? "Workout";
  const showEditButtons = aoId != null;
  const editableEventId = isInstanceEventId(panelEventId) ? null : panelEventId;

  // Get short day of week and format time
  const shortDayOfWeek = getShortDayOfWeek(selectedEvent?.dayOfWeek);
  const formattedTime = formatTime(selectedEvent?.startTime);
  const timeDisplay =
    shortDayOfWeek && formattedTime ? `${shortDayOfWeek} ${formattedTime}` : "";

  if (!panelLocationId) return null;

  return (
    <div
      data-testid={TestId.PANEL}
      className="pointer-events-auto relative flex flex-col rounded-lg bg-background p-4 shadow-sm dark:border"
    >
      {/* Close button in the top right */}
      <button
        type="button"
        aria-label="Close location panel"
        className="absolute top-2 right-2 rounded-full bg-muted-foreground px-1 py-1 text-sm text-background"
        onClick={(e) => {
          closePanel();
          e.stopPropagation();
        }}
      >
        <X className="h-4 w-4" />
      </button>

      {/* Edit buttons at the top */}
      {mode === "edit" && showEditButtons && (
        <div className="mb-4">
          <LocationEditButtons
            locationId={panelLocationId}
            eventId={editableEventId}
            aoName={aoName}
            aoId={aoId}
            eventName={eventName}
            timeDisplay={timeDisplay}
            eventCount={locationData?.location?.events.length ?? 0}
          />
        </div>
      )}

      <WorkoutDetailsContent
        locationId={panelLocationId}
        providedEventId={panelEventId}
        chipSize={isLarge ? "large" : isMedium ? "medium" : "small"}
      />

      <div className="h-8" />
    </div>
  );
};
