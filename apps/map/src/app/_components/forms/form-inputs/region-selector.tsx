import { Controller, useFormContext } from "react-hook-form";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useOptions } from "~/utils/use-options";

interface RegionSelectorProps {
  label?: string;
  fieldName?: "originalRegionId" | "newRegionId";
  /** Optional field to sync with the same value (e.g., for moves within same region) */
  syncWithField?: "originalRegionId" | "newRegionId";
}

interface RegionSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
  originalEventId?: number | null;
  newEventId?: number | null;
}

/**
 * Region selector component - handles region selection only
 * Single Responsibility: Display and manage region selection
 * Side Effects:
 * - Clears dependent AO and Event fields when region changes
 * - Optionally syncs value with another region field (for same-region moves)
 */
export function RegionSelector<_T extends RegionSelectorFormValues>({
  label = "In Region:",
  fieldName = "newRegionId",
  syncWithField,
}: RegionSelectorProps) {
  const form = useFormContext<RegionSelectorFormValues>();
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );

  const regionOptions = useOptions(
    regions?.orgs,
    (r) => r.name,
    (r) => r.id.toString(),
  );

  // Determine which dependent fields to clear based on the region field
  const getDependentFields = () => {
    if (fieldName === "originalRegionId") {
      return {
        aoField: "originalAoId" as const,
        eventField: "originalEventId" as const,
      };
    }
    return {
      aoField: "newAoId" as const,
      eventField: "newEventId" as const,
    };
  };

  const { aoField, eventField } = getDependentFields();

  return (
    <div className="flex-1 space-y-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <Controller
        control={form.control}
        name={fieldName}
        render={({ field, fieldState }) => (
          <>
            <VirtualizedCombobox
              options={regionOptions}
              value={field.value?.toString()}
              onSelect={(item) => {
                const region = regions?.orgs.find(
                  (region) => region.id.toString() === item,
                );
                const newValue = region?.id ?? null;

                // Set the primary region field
                form.setValue(fieldName, newValue);

                // Sync with another field if specified (e.g., for same-region moves)
                if (syncWithField) {
                  form.setValue(syncWithField, newValue);
                }

                // Clear dependent fields when region changes
                if (field.value !== newValue) {
                  form.setValue(aoField, null);
                  form.setValue(eventField, null);
                }
              }}
              searchPlaceholder="Select Region"
            />
            <p className="text-xs text-destructive">
              {fieldState.error?.message?.toString()}
            </p>
          </>
        )}
      />
    </div>
  );
}
