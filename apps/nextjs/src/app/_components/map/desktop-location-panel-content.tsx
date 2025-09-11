import { useWindowWidth } from "@react-hook/window-size";
import { X } from "lucide-react";

import { BreakPoints } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";

import { closePanel, selectedItemStore } from "~/utils/store/selected-item";
import { WorkoutDetailsContent } from "../workout/workout-details-content";

export const DesktopLocationPanelContent = () => {
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const panelEventId = selectedItemStore.use.panelEventId();
  const width = useWindowWidth();
  const isLarge = width > Number(BreakPoints.LG);
  const isMedium = width > Number(BreakPoints.MD);

  if (!panelLocationId) return null;

  return (
    <div
      data-testid={TestId.PANEL}
      className="pointer-events-auto relative flex flex-col rounded-lg bg-background p-4 shadow dark:border"
    >
      <WorkoutDetailsContent
        locationId={panelLocationId}
        providedEventId={panelEventId}
        chipSize={isLarge ? "large" : isMedium ? "medium" : "small"}
      />

      <div className="h-8" />
      <div className="absolute right-2 top-2 flex flex-row gap-2">
        <button
          className="rounded-full bg-muted-foreground px-1 py-1 text-sm text-background"
          onClick={(e) => {
            closePanel();
            e.stopPropagation();
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
