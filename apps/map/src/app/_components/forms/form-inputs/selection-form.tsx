import { Controller, useFormContext } from "react-hook-form";

import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";

import { orpc, useQuery } from "~/orpc/react";
import { useOptions } from "~/utils/use-options";
import { VirtualizedCombobox } from "../../virtualized-combobox";

interface SelectionFormProps {
  title?: string;
  regionLabel?: string;
  aoLabel?: string;
  eventLabel?: string;
  includeRegion?: boolean;
  includeAO?: boolean;
  includeEvent?: boolean;
}

interface SelectionFormValues {
  originalRegionId?: number | null;
  originalAoId?: number | null;
  originalEventId?: number | null;
  newRegionId?: number | null;
  newAoId?: number | null;
  newEventId?: number | null;
}

/**
 * @deprecated This component violates SOLID principles.
 * Use the new focused components instead:
 * - RegionSelector: For region selection only
 * - AOSelector: For AO selection only
 * - EventSelector: For event selection only
 * - RegionAndAOSelector: For region + AO selection
 * - RegionAndEventSelector: For region + event selection
 * - RegionAOEventSelector: For region + AO + event selection
 *
 * These components follow the Single Responsibility Principle and are
 * easier to test, maintain, and compose.
 */
export const SelectionForm = <_T extends SelectionFormValues>(
  props: SelectionFormProps,
) => {
  const form = useFormContext<SelectionFormValues>();
  const _formOriginalRegionId = form.watch("originalRegionId");
  const formNewRegionId = form.watch("newRegionId");
  const _formOriginalAOId = form.watch("originalAoId");
  const formNewAOId = form.watch("newAoId");
  const _formOriginalEventId = form.watch("originalEventId");
  const _formNewEventId = form.watch("newEventId");

  const { data: regions } = useQuery(orpc.location.getRegions.queryOptions());

  const { data: events } = useQuery(
    orpc.event.all.queryOptions({
      input: {
        ...(formNewAOId ? { aoIds: [formNewAOId] } : {}),
        ...(formNewRegionId ? { regionIds: [formNewRegionId] } : {}),
      },
      enabled: formNewRegionId != null,
    }),
  );

  const { data: aos } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: ["ao"],
        parentOrgIds: formNewRegionId ? [formNewRegionId] : undefined,
        pageSize: 200,
      },
      enabled: formNewRegionId != null,
    }),
  );

  const regionOptions = useOptions(
    regions,
    (r) => r.name,
    (r) => r.id.toString(),
  );
  const aoOptions = useOptions(
    aos?.orgs,
    (ao) => `${ao.name} (${ao.parentOrgName})`,
    (ao) => ao.id.toString(),
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
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        {props.title ?? "Choose Event:"}
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        {props.includeRegion && (
          <div className="flex-1">
            <div className="text-sm font-medium text-muted-foreground">
              {props.regionLabel ?? "In Region:"}
            </div>
            <Controller
              control={form.control}
              name="newRegionId"
              render={({ field, fieldState }) => (
                <>
                  <VirtualizedCombobox
                    key={field.value?.toString()}
                    options={regionOptions}
                    value={field.value?.toString()}
                    onSelect={(item) => {
                      const region = regions?.find(
                        (region) => region.id.toString() === item,
                      );
                      form.setValue(
                        "newRegionId",
                        // @ts-expect-error - need to unset regionId despite zod
                        region?.id ?? (null as number),
                      );
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
        )}
        {props.includeAO && (
          <div className="flex-1">
            <div className="text-sm font-medium text-muted-foreground">
              {props.aoLabel ?? "From AO (optional):"}
            </div>
            <Controller
              control={form.control}
              name="newAoId"
              render={({ field, fieldState }) => (
                <>
                  <VirtualizedCombobox
                    key={formNewRegionId?.toString()}
                    options={aoOptions}
                    value={field.value?.toString()}
                    onSelect={(item) => {
                      const ao = aos?.orgs?.find(
                        (ao) => ao.id.toString() === item,
                      );
                      field.onChange(ao?.id ?? null);
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
        )}
        {props.includeEvent && (
          <div className="flex-1">
            <div className="text-sm font-medium text-muted-foreground">
              {props.eventLabel ?? "Event to move:"}
            </div>
            <Controller
              control={form.control}
              name="newEventId"
              render={({ field, fieldState }) => (
                <>
                  <VirtualizedCombobox
                    key={formNewRegionId?.toString()}
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
        )}
      </div>
    </>
  );
};
