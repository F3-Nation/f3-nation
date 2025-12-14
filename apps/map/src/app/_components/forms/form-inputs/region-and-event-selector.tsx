import { EventSelector } from "./event-selector";
import { RegionSelector } from "./region-selector";

interface RegionAndEventSelectorProps {
  title?: string;
  regionLabel?: string;
  eventLabel?: string;
  regionFieldName?: "originalRegionId" | "newRegionId";
  eventFieldName?: "originalEventId" | "newEventId";
}

/**
 * Composed component for Region + Event selection
 * Follows Open/Closed Principle: New selection combinations can be added
 * without modifying existing components
 */
export function RegionAndEventSelector({
  title = "Choose Event:",
  regionLabel = "In Region:",
  eventLabel = "Event to move:",
  regionFieldName = "newRegionId",
  eventFieldName = "newEventId",
}: RegionAndEventSelectorProps) {
  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        <RegionSelector label={regionLabel} fieldName={regionFieldName} />
        <EventSelector
          label={eventLabel}
          fieldName={eventFieldName}
          regionFieldName={regionFieldName}
        />
      </div>
    </>
  );
}
