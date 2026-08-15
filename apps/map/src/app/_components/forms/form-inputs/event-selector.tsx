import { useEffect } from "react";
import { Controller, useFormContext } from "react-hook-form";

import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";

import { client } from "~/orpc/client";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { useOptions } from "~/utils/use-options";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import { SelectorLoadError } from "./selector-load-error";

interface EventSelectorProps {
  label?: string;
  fieldName?: "originalEventId";
  regionFieldName?: "originalRegionId" | "newRegionId";
  aoFieldName?: "originalAoId" | "newAoId";
}

interface EventSelectorFormValues {
  originalRegionId?: number | null;
  newRegionId?: number | null;
  originalAoId?: number | null;
  newAoId?: number | null;
  originalEventId?: number | null;
}

/**
 * Event selector component - handles event selection based on selected region/AO
 * Single Responsibility: Display and manage event selection
 * Depends on region being selected first
 */
export function EventSelector({
  label = "Event to move:",
  fieldName = "originalEventId",
  regionFieldName = "newRegionId",
  aoFieldName = "newAoId",
}: EventSelectorProps) {
  const form = useFormContext<EventSelectorFormValues>();
  const regionId = form.watch(regionFieldName);
  const aoId = form.watch(aoFieldName);
  const selectedEventId = form.watch(fieldName);

  const eventFilter = {
    ...(aoId ? { aoIds: [aoId] } : {}),
    ...(regionId ? { regionIds: [regionId] } : {}),
  };
  const {
    data: events,
    isError,
    refetch,
  } = useFetchAllPages({
    queryKey: ["event.all.everyMatching", eventFilter],
    enabled: regionId != null,
    throwOnError: false,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { events: items, totalCount } = await client.event.all({
        ...eventFilter,
        pageIndex,
        pageSize,
      });
      return { items, total: totalCount };
    },
  });

  const eventOptions = useOptions(
    events,
    (e) =>
      e.dayOfWeek
        ? `${e.name} (${dayOfWeekToShortDayOfWeek(e.dayOfWeek)})`
        : e.name,
    (e) => e.id.toString(),
  );

  useEffect(() => {
    if (selectedEventId == null || !events) return;
    const exists = events.some((event) => event.id === selectedEventId);
    if (!exists) {
      form.setValue(fieldName, null, { shouldValidate: true });
    }
  }, [events, selectedEventId, fieldName, form]);

  return (
    <div className="flex-1 space-y-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <Controller
        control={form.control}
        name={fieldName}
        render={({ field, fieldState }) => (
          <>
            <VirtualizedCombobox
              key={`${regionId ?? "none"}-${aoId ?? "none"}`}
              options={eventOptions}
              value={field.value?.toString()}
              onSelect={(item) => {
                const event = events?.find(
                  (event) => event.id.toString() === item,
                );
                field.onChange(event?.id ?? null);
              }}
              searchPlaceholder="Select Event"
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
