import { AOSelector } from "./ao-selector";
import { EventSelector } from "./event-selector";
import { RegionSelector } from "./region-selector";

interface RegionAOEventSelectorProps {
  title?: string;
  regionLabel?: string;
  aoLabel?: string;
  eventLabel?: string;
  regionFieldName?: "originalRegionId" | "newRegionId";
  aoFieldName?: "originalAoId" | "newAoId";
  eventFieldName?: "originalEventId" | "newEventId";
}

interface RegionAOEventSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
  originalEventId?: number | null;
  newEventId?: number | null;
}
/**
 * Composed component for Region + AO + Event selection
 * Follows Open/Closed Principle: New selection combinations can be added
 * without modifying existing components
 */
export function RegionAOEventSelector<
  _T extends RegionAOEventSelectorFormValues,
>({
  title = "Choose Event:",
  regionLabel = "In Region:",
  aoLabel = "From AO (optional):",
  eventLabel = "Event to move:",
  regionFieldName = "newRegionId",
  aoFieldName = "newAoId",
  eventFieldName = "newEventId",
}: RegionAOEventSelectorProps) {
  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        <RegionSelector<_T> label={regionLabel} fieldName={regionFieldName} />
        <AOSelector<_T>
          label={aoLabel}
          fieldName={aoFieldName}
          regionFieldName={
            regionFieldName as "originalRegionId" | "newRegionId"
          }
        />
        <EventSelector<_T>
          label={eventLabel}
          fieldName={eventFieldName}
          regionFieldName={regionFieldName}
          aoFieldName={aoFieldName}
        />
      </div>
    </>
  );
}
