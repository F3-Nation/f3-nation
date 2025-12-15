import { useWindowWidth } from "@react-hook/window-size";

import { BreakPoints, Z_INDEX } from "@acme/shared/app/constants";
import { Dialog, DialogContent, DialogHeader } from "@acme/ui/dialog";

import type { DataType, ModalType } from "~/utils/store/modal";
import { orpc, useQuery } from "~/orpc/react";
import { closeModal } from "~/utils/store/modal";
import { selectedItemStore } from "~/utils/store/selected-item";
import { WorkoutDetailsContent } from "../workout/workout-details-content";

export const WorkoutDetailsModal = ({
  data,
}: {
  data: DataType[ModalType.WORKOUT_DETAILS];
}) => {
  const selectedLocationId = selectedItemStore.use.locationId();
  const selectedEventId = selectedItemStore.use.eventId();
  const providedLocationId =
    typeof data.locationId === "number" ? data.locationId : -1;
  const locationId = selectedLocationId ?? providedLocationId;
  const { data: results } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId },
      enabled: locationId >= 0,
    }),
  );
  const modalEventId =
    results?.location.events.find((e) => e.id === selectedEventId)?.id ??
    results?.location.events[0]?.id ??
    null;
  const width = useWindowWidth();
  const isLarge = width > Number(BreakPoints.LG);
  const isMedium = width > Number(BreakPoints.MD);

  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.WORKOUT_DETAILS_MODAL }}
        className="mb-40 rounded-lg px-4 sm:px-6 lg:rounded-none lg:px-8"
      >
        <DialogHeader className="flex flex-row flex-wrap items-center justify-start gap-x-2">
          {/* Empty DialogHeader to maintain structure */}
        </DialogHeader>

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
