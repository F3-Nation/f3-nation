import { useMemo } from "react";

import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

// Synthetic option for the not-yet-created AO.
const NEW_AO_OPTION_VALUE = "__new_ao__";

export const MoveEventToDifferentAoRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const formAoId = form.watch("aoId");
  const formAoName = form.watch("aoName");
  const requestType = form.watch("requestType");
  const meta = form.watch("meta");

  // New AO hasn't been created yet — only has a name, no id.
  const isNewAo = requestType === "move_event_to_new_ao";

  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions(),
  );
  const { data: allAoData } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );

  const regions = regionsResponse?.regions;
  const aos = useMemo(() => allAoData?.orgs ?? [], [allAoData]);
  const destinationAoOptions = useMemo(() => {
    // Treat -1/null/0 (no region selected) as unfiltered so the AO list isn't empty.
    const hasRegionFilter = !!formRegionId && formRegionId !== -1;
    const existing = aos
      .filter((ao) => !hasRegionFilter || ao.parentId === formRegionId)
      .map((ao) => ({
        label: ao.name,
        value: ao.id.toString(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (isNewAo && formAoName) {
      return [
        { label: `${formAoName} (New AO)`, value: NEW_AO_OPTION_VALUE },
        ...existing,
      ];
    }
    return existing;
  }, [aos, formRegionId, isNewAo, formAoName]);

  const originalEventId = meta?.originalEventId;
  const originalAoId = meta?.originalAoId;

  const { data: eventResponse } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: Number(originalEventId) },
      enabled: originalEventId != null,
    }),
  );
  const event = eventResponse?.event;

  const dayOfWeek = event?.dayOfWeek
    ? convertCase({
        str: event.dayOfWeek,
        fromCase: Case.LowerCase,
        toCase: Case.TitleCase,
      })
    : null;
  const time = event?.startTime
    ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ""}`
    : null;
  const eventTypes = event?.eventTypes
    .map((type) => type.eventTypeName)
    .join(", ");

  // Default to the synthetic "New AO" option unless the admin picks a different one.
  const destinationAoValue =
    isNewAo && (formAoId == null || formAoId === originalAoId)
      ? formAoName
        ? NEW_AO_OPTION_VALUE
        : undefined
      : formAoId != null
        ? formAoId.toString()
        : undefined;

  return (
    <>
      <DevMetaSummary
        title="Move Workout:"
        items={[
          { label: "Workout ID", value: originalEventId },
          { label: "Current AO ID", value: originalAoId },
        ]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Current Workout:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Workout Name
          </div>
          <div className="text-sm">{event?.name ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Current AO
          </div>
          <div className="text-sm">{event?.location ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Day of Week
          </div>
          <div className="text-sm">{dayOfWeek ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">Time</div>
          <div className="text-sm">{time ?? "—"}</div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Types
          </div>
          <div className="text-sm">{eventTypes ?? "—"}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Destination AO:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Destination Region
          </div>
          <VirtualizedCombobox
            key={formRegionId?.toString()}
            options={
              regions
                ?.map((region) => ({
                  label: region.name,
                  value: region.id.toString(),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)) ?? []
            }
            value={formRegionId?.toString()}
            onSelect={(item) => {
              const region = regions?.find(
                (region) => region.id.toString() === item,
              );
              form.setValue("regionId", region?.id ?? -1);

              // Reset a selected AO that no longer fits the region; keep new-AO drafts.
              const selectedAo = aos.find((ao) => ao.id === formAoId);
              if (selectedAo && selectedAo.parentId !== region?.id) {
                form.setValue("aoId", null);
                form.setValue("locationId", null);
                form.setValue("aoName", "");
                form.setValue("aoLogo", "");
                form.setValue("aoWebsite", "");
              }
            }}
            searchPlaceholder="Select a region"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.regionId?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Destination AO
          </div>
          <VirtualizedCombobox
            key={`${formRegionId ?? "all"}-${formAoId ?? destinationAoValue ?? "none"}`}
            options={destinationAoOptions}
            value={destinationAoValue}
            onSelect={(item) => {
              // Re-selecting the temporary new AO keeps the request's new AO
              // details (name/logo/website) and leaves it without an id.
              if (item === NEW_AO_OPTION_VALUE) {
                form.setValue("aoId", null);
                return;
              }

              const ao = aos.find((ao) => ao.id.toString() === item);
              form.setValue("aoId", ao?.id ?? null);
              form.setValue("locationId", ao?.defaultLocationId ?? null);
              form.setValue("aoName", ao?.name ?? "");
              form.setValue("aoLogo", ao?.logoUrl ?? "");
              form.setValue("aoWebsite", ao?.website ?? "");

              if (ao?.parentId) {
                form.setValue("regionId", ao.parentId);
              }
            }}
            searchPlaceholder="Select an AO"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoId?.message}
          </p>
        </div>
      </div>

      {isNewAo && <LocationDetailsFields />}

      <SubmitterEmailField />
    </>
  );
};
