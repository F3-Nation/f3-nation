import { Controller, useFormContext } from "react-hook-form";

import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";

import { orpc, useQuery } from "~/orpc/react";
import { useOptions } from "~/utils/use-options";
import { VirtualizedCombobox } from "../../virtualized-combobox";

interface EventSelectorProps {
  label?: string;
  fieldName?: "originalEventId" | "newEventId";
  regionFieldName?: "originalRegionId" | "newRegionId";
  aoFieldName?: "originalAoId" | "newAoId";
}

interface EventSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
  originalEventId?: number | null;
  newEventId?: number | null;
}

/**
 * Event selector component - handles event selection based on selected region/AO
 * Single Responsibility: Display and manage event selection
 * Depends on region being selected first
 */
export function EventSelector<_T extends EventSelectorFormValues>({
  label = "Event to move:",
  fieldName = "newEventId",
  regionFieldName = "newRegionId",
  aoFieldName = "newAoId",
}: EventSelectorProps) {
  const form = useFormContext<EventSelectorFormValues>();
  const regionId = form.watch(regionFieldName);
  const aoId = form.watch(aoFieldName);

  const { data: events } = useQuery(
    orpc.event.all.queryOptions({
      input: {
        ...(aoId ? { aoIds: [aoId] } : {}),
        ...(regionId ? { regionIds: [regionId] } : {}),
      },
      enabled: regionId != null,
    }),
  );

  const eventOptions = useOptions(
    events?.events,
    (e) =>
      e.dayOfWeek
        ? `${e.name} (${dayOfWeekToShortDayOfWeek(e.dayOfWeek)})`
        : e.name,
    (e) => e.id.toString(),
  );

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
              options={eventOptions}
              value={field.value?.toString()}
              onSelect={(item) => {
                const event = events?.events?.find(
                  (event) => event.id.toString() === item,
                );
                field.onChange(event?.id ?? null);
              }}
              searchPlaceholder="Select Event"
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
