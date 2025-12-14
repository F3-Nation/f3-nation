import { AOSelector } from "./ao-selector";
import { RegionSelector } from "./region-selector";

interface RegionAndAOSelectorProps {
  title?: string;
  regionLabel?: string;
  aoLabel?: string;
  regionFieldName?: "originalRegionId" | "newRegionId";
  aoFieldName?: "originalAoId" | "newAoId";
  /** Set to true when moving within the same region (syncs originalRegionId with newRegionId) */
  sameRegionMove?: boolean;
}

interface RegionAndAOSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
}

/**
 * Composed component for Region + AO selection
 * Follows Open/Closed Principle: New selection combinations can be added
 * without modifying existing components
 */
export function RegionAndAOSelector<_T extends RegionAndAOSelectorFormValues>({
  title = "Choose AO:",
  regionLabel = "In Region:",
  aoLabel = "AO to move:",
  regionFieldName = "newRegionId",
  aoFieldName = "newAoId",
  sameRegionMove = false,
}: RegionAndAOSelectorProps) {
  // For same-region moves, sync the selected region with both original and new
  const syncField = sameRegionMove
    ? regionFieldName === "newRegionId"
      ? "originalRegionId"
      : "newRegionId"
    : undefined;

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        <RegionSelector<_T>
          label={regionLabel}
          fieldName={regionFieldName}
          syncWithField={syncField}
        />
        <AOSelector<_T>
          label={aoLabel}
          fieldName={aoFieldName}
          regionFieldName={regionFieldName}
        />
      </div>
    </>
  );
}
