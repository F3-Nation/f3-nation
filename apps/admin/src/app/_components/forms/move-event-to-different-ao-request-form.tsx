import { useMemo } from "react";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveEventToDifferentAoRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const formAoId = form.watch("aoId");
  const meta = form.watch("meta");

  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions(),
  );
  const { data: allAoData } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );

  const regions = regionsResponse?.regions;
  const aos = useMemo(() => allAoData?.orgs ?? [], [allAoData]);
  const destinationAoOptions = useMemo(() => {
    return aos
      .filter((ao) => !formRegionId || ao.parentId === formRegionId)
      .map((ao) => ({
        label: `${ao.name} (${ao.parentOrgName})`,
        value: ao.id.toString(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aos, formRegionId]);

  const originalEventId = meta?.originalEventId;
  const originalAoId = meta?.originalAoId;

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
            key={`${formRegionId ?? "all"}-${formAoId ?? "none"}`}
            options={destinationAoOptions}
            value={formAoId?.toString()}
            onSelect={(item) => {
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
