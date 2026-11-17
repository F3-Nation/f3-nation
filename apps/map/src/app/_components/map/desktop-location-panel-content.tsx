import { ChevronLeft } from "lucide-react";

import { TestId } from "@acme/shared/common/enums";

import { orpc, useQuery } from "~/orpc/react";
import { appStore } from "~/utils/store/app";
import { closePanel, selectedItemStore } from "~/utils/store/selected-item";
import { WorkoutDetailsContent } from "../workout/workout-details-content";
import {
  formatTime,
  getShortDayOfWeek,
  LocationEditButtons,
  resolveAoId,
  useEditableEventId,
} from "./location-edit-buttons";

/** Workout details in the left panel, with a link back to the nearby list. */
export const DesktopLocationPanelContent = () => {
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const panelEventId = selectedItemStore.use.panelEventId();
  const mode = appStore.use.mode();

  // Get location data including events
  const { data: locationData } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId: panelLocationId ?? -1 },
      enabled: panelLocationId !== null,
    }),
  );

  const editableEventId = useEditableEventId({
    selectedEventId: panelEventId,
    events: locationData?.location?.events,
  });

  // Get AO name and selected event name. Label the edit buttons with the event
  // they actually act on, which for a temporary change is the resolved parent
  // series rather than the instance.
  const aoName = locationData?.location?.parentName ?? "AO";
  const selectedEvent = locationData?.location?.events.find(
    (event) => event.id === editableEventId,
  );
  const modalAOIds = locationData?.location?.events.map((e) => e.aoId);
  const aoId = resolveAoId({
    selectedEventAoId: selectedEvent?.aoId,
    eventAoIds: modalAOIds,
  });
  const eventName = selectedEvent?.name ?? "Workout";
  const showEditButtons = aoId != null;

  // Get short day of week and format time
  const shortDayOfWeek = getShortDayOfWeek(selectedEvent?.dayOfWeek);
  const formattedTime = formatTime(selectedEvent?.startTime);
  const timeDisplay =
    shortDayOfWeek && formattedTime ? `${shortDayOfWeek} ${formattedTime}` : "";

  if (!panelLocationId) return null;

  return (
    <div
      data-testid={TestId.PANEL}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-8"
    >
      <button
        type="button"
        aria-label="Close location panel"
        className="mb-4 flex w-fit flex-row items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase hover:text-foreground"
        onClick={(e) => {
          closePanel();
          e.stopPropagation();
        }}
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        Nearby workouts
      </button>

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
      />
    </div>
  );
};
