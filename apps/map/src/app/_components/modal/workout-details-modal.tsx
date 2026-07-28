import { useWindowWidth } from "@react-hook/window-size";
import { useMemo } from "react";

import { BreakPoints, Z_INDEX } from "@acme/shared/app/constants";
import { Dialog, DialogContent, DialogHeader } from "@acme/ui/dialog";

import type { DataType, ModalType } from "~/utils/store/modal";
import { orpc, useQuery } from "~/orpc/react";
import { appStore } from "~/utils/store/app";
import { closeModal } from "~/utils/store/modal";
import { selectedItemStore } from "~/utils/store/selected-item";
import {
  formatTime,
  getShortDayOfWeek,
  LocationEditButtons,
} from "../map/location-edit-buttons";
import { WorkoutDetailsContent } from "../workout/workout-details-content";

export const WorkoutDetailsModal = ({
  data,
}: {
  data: DataType[ModalType.WORKOUT_DETAILS];
}) => {
  const selectedLocationId = selectedItemStore.use.locationId();
  const selectedEventId = selectedItemStore.use.eventId();
  const mode = appStore.use.mode();
  const providedLocationId =
    typeof data.locationId === "number" ? data.locationId : -1;
  const locationId = selectedLocationId ?? providedLocationId;
  const { data: results } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId },
      enabled: locationId >= 0,
    }),
  );
  const location = results?.location;
  const modalEventId =
    typeof data.eventId === "number"
      ? data.eventId
      : (location?.events.find((e) => e.id === selectedEventId)?.id ??
        location?.events[0]?.id ??
        selectedEventId ??
        null);
  const modalAOIds = results?.location?.events.map((e) => e.aoId);

  const { data: upcomingInstancesData } = useQuery(
    orpc.map.location.upcomingInstances.queryOptions({
      input: undefined,
      enabled: mode === "edit" && (modalEventId ?? 0) < 0,
    }),
  );

  // Temporary AO changes surface instance-derived pseudo-events, encoded as
  // negative ids (`-instance.id`) that don't exist in `location.events`. The
  // edit flow resolves `eventId` against that list (`openRequestModal` ->
  // `getFormValues`), so handing it a pseudo-id opens a form filled with blank
  // defaults and submits a negative `originalEventId` — its guards are
  // truthiness-based, and a negative number passes. Resolve a pseudo-id to the
  // parent series event, which is the real thing an editor can change. An
  // orphan instance (no series, or a series absent from this location) has no
  // editable parent, so yield null and let LocationEditButtons drop its workout
  // menu while keeping AO-level actions.
  const editableEventId = useMemo(() => {
    if (modalEventId == null) return null;
    if (modalEventId > 0) return modalEventId;
    const seriesId =
      upcomingInstancesData?.find((instance) => instance.id === -modalEventId)
        ?.seriesId ?? null;
    if (seriesId == null) return null;
    return location?.events.some((event) => event.id === seriesId)
      ? seriesId
      : null;
  }, [modalEventId, upcomingInstancesData, location?.events]);

  const width = useWindowWidth();
  const isLarge = width > Number(BreakPoints.LG);
  const isMedium = width > Number(BreakPoints.MD);

  // Label the edit buttons with the event they actually act on, which for a
  // temporary change is the resolved parent series rather than the instance.
  const selectedEvent = results?.location?.events.find(
    (event) => event.id === editableEventId,
  );
  const eventName = selectedEvent?.name ?? "Workout";
  const aoName = results?.location?.parentName ?? "AO";
  const aoId = selectedEvent?.aoId ?? modalAOIds?.[0] ?? null;

  // Format time display
  const shortDayOfWeek = getShortDayOfWeek(selectedEvent?.dayOfWeek);
  const formattedTime = formatTime(selectedEvent?.startTime);
  const timeDisplay =
    shortDayOfWeek && formattedTime ? `${shortDayOfWeek} ${formattedTime}` : "";

  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.WORKOUT_DETAILS_MODAL }}
        className="mb-40 max-w-[95vw] rounded-lg px-3 sm:px-6 lg:rounded-none lg:px-8"
      >
        <DialogHeader className="flex flex-row flex-wrap items-center justify-start gap-x-2">
          {/* Empty DialogHeader to maintain structure */}
        </DialogHeader>

        {/* Edit buttons - only in edit mode */}
        {mode === "edit" && locationId > 0 && (
          <div className="mb-4">
            <LocationEditButtons
              locationId={locationId}
              eventId={editableEventId}
              aoId={aoId}
              aoName={aoName}
              eventName={eventName}
              timeDisplay={timeDisplay}
              eventCount={results?.location?.events.length ?? 0}
            />
          </div>
        )}

        <WorkoutDetailsContent
          // Need to provide a fallback for selectedEventId
          locationId={locationId}
          providedEventId={modalEventId}
          chipSize={isLarge ? "large" : isMedium ? "medium" : "large"}
        />

        <div className="h-2" />
        <div className="flex w-full flex-col justify-center gap-4">
          <button
            className="flex cursor-pointer flex-row items-center justify-center gap-2 rounded-md bg-muted-foreground px-2 py-1 text-background"
            onClick={() => closeModal()}
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
