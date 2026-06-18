import { useMemo } from "react";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

// Sentinel value for the temporary AO described by a `move_event_to_new_ao`
// request. The AO does not exist in the DB yet, so it has no real id.
const NEW_AO_OPTION_VALUE = "__new_ao__";

export const MoveEventToDifferentAoRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const formAoId = form.watch("aoId");
  const formAoName = form.watch("aoName");
  const requestType = form.watch("requestType");
  const meta = form.watch("meta");

  // `move_event_to_new_ao` references an AO that hasn't been created yet, so it
  // only carries an `aoName` (no `aoId`). Surface it as a synthetic option.
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
    const existing = aos
      .filter((ao) => !formRegionId || ao.parentId === formRegionId)
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

  // For a `move_event_to_new_ao` request the stored `aoId` is the event's
  // current (source) AO, since the destination AO doesn't exist yet. Treat that
  // as "new AO selected" unless the admin actively picks a different existing AO.
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

      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
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

              const selectedAo = aos.find((ao) => ao.id === formAoId);
              if (selectedAo?.parentId !== region?.id) {
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

      <SubmitterEmailField />
    </>
  );
};
