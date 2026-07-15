import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { Controller, useFormContext } from "react-hook-form";

import { orpc, useQuery } from "~/orpc/react";
import { SelectorLoadError } from "./selector-load-error";

interface AOSelectorProps {
  label?: string;
  fieldName?: "originalAoId" | "newAoId";
  regionFieldName?: "originalRegionId" | "newRegionId";
}

interface AOSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
  originalEventId?: number | null;
}

/**
 * AO selector component - handles AO selection based on selected region
 * Single Responsibility: Display and manage AO selection
 * Depends on region being selected first
 * Side Effects: Clears dependent Event field when AO changes
 */
export function AOSelector<_T extends AOSelectorFormValues>({
  label = "From AO (optional):",
  fieldName = "newAoId",
  regionFieldName = "newRegionId",
}: AOSelectorProps) {
  const form = useFormContext<AOSelectorFormValues>();
  const regionId = form.watch(regionFieldName);

  const {
    data: results,
    isError,
    refetch,
  } = useQuery({
    ...orpc.map.location.getAOsInRegion.queryOptions({
      input: { regionId: regionId ?? -1 },
      enabled: regionId != null,
    }),
    throwOnError: false,
  });

  const aoOptions =
    results?.aos
      ?.map((ao) => ({
        label: ao.name,
        value: ao.id.toString(),
        labelComponent: (
          <div className="flex flex-col">
            <div>{ao.name}</div>
            {ao.workouts.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                {ao.workouts.join(", ")}
              </div>
            )}
          </div>
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)) ?? [];

  // The event field to clear when the AO changes. Selecting a destination AO
  // ("newAoId") has no dependent event field: no request type picks an event
  // under a destination AO
  const eventField = fieldName === "originalAoId" ? "originalEventId" : null;

  return (
    <div className="flex-1 space-y-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <Controller
        control={form.control}
        name={fieldName}
        render={({ field, fieldState }) => (
          <>
            <VirtualizedCombobox
              key={regionId?.toString()}
              options={aoOptions}
              value={field.value?.toString()}
              onSelect={(item) => {
                const ao = results?.aos?.find(
                  (ao) => ao.id.toString() === item,
                );
                const newValue = ao?.id ?? null;

                // Set the AO
                field.onChange(newValue);

                // Clear dependent event field when AO changes
                if (field.value !== newValue && eventField) {
                  form.setValue(eventField, null);
                }
              }}
              searchPlaceholder="Select AO"
            />
            {isError ? (
              <SelectorLoadError onRetry={() => void refetch()} />
            ) : (
              <p className="text-xs text-destructive">
                {fieldState.error?.message?.toString()}
              </p>
            )}
          </>
        )}
      />
    </div>
  );
}
