import { Controller, useFormContext } from "react-hook-form";

import { orpc, useQuery } from "~/orpc/react";
import { VirtualizedCombobox } from "../../virtualized-combobox";

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
  newEventId?: number | null;
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

  const { data: results } = useQuery(
    orpc.location.getAOsInRegion.queryOptions({
      input: { regionId: regionId ?? -1 },
      enabled: regionId != null,
    }),
  );

  const aoOptions =
    results?.aos
      ?.map((ao) => ({
        label: ao.name,
        value: ao.id.toString(),
        labelComponent: (
          <div className="flex flex-col">
            <div>{ao.name}</div>
            {Array.isArray(ao.workouts) && ao.workouts.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                {ao.workouts
                  .filter((w): w is string => typeof w === "string")
                  .join(", ")}
              </div>
            )}
          </div>
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)) ?? [];

  // Determine which event field to clear based on the AO field
  const getEventField = () => {
    if (fieldName === "originalAoId") {
      return "originalEventId" as const;
    }
    return "newEventId" as const;
  };

  const eventField = getEventField();

  return (
    <div className="flex-1">
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
                if (field.value !== newValue) {
                  form.setValue(eventField, null);
                }
              }}
              searchPlaceholder="Select AO"
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
