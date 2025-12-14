import { useMemo } from "react";
import { Controller, useFormContext } from "react-hook-form";

import { isTruthy } from "@acme/shared/common/functions";

import { api } from "~/trpc/react";
import { VirtualizedCombobox } from "../../virtualized-combobox";

interface ExistingLocationPickerFormValues {
  newLocationId: number;
  originalLocationId: number;
  originalRegionId: number;
  newRegionId?: number;
}

export const ExistingLocationPickerForm = <
  _T extends ExistingLocationPickerFormValues,
>(params: {
  region: "originalRegion" | "newRegion";
}) => {
  const form = useFormContext<ExistingLocationPickerFormValues>();
  const formNewRegionId = form.watch("newRegionId");
  const formOriginalRegionId = form.watch("originalRegionId");

  const disabled =
    (params.region === "newRegion" && !formNewRegionId) ||
    (params.region === "originalRegion" && !formOriginalRegionId);

  // Get location data
  const { data: locations } = api.location.all.useQuery();

  const sortedRegionLocationOptions = useMemo(() => {
    return (
      locations?.locations
        // If we have an original regionId, only show those, otherwise use the formRegionId
        ?.filter((l) =>
          params.region === "originalRegion"
            ? l.regionId === formOriginalRegionId
            : l.regionId === formNewRegionId,
        )
        ?.sort((a, b) => a.locationName.localeCompare(b.locationName))
        ?.map((l) => ({
          labelComponent: (
            <span>
              {`${l.locationName}${l.regionName ? ` (${l.regionName})` : ""}`}
              <span className="text-foreground/30">{` ${[l.addressStreet, l.addressStreet2, l.addressCity, l.addressState, l.addressZip, l.addressCountry].filter(isTruthy).join(", ")}`}</span>
            </span>
          ),
          label: `${l.locationName}${l.regionName ? ` (${l.regionName})` : ""} ${[l.addressStreet, l.addressStreet2, l.addressCity, l.addressState, l.addressZip, l.addressCountry].filter(isTruthy).join(", ")}`,
          value: l.id.toString(),
          regionId: l.regionId,
        }))
    );
  }, [
    locations?.locations,
    params.region,
    formOriginalRegionId,
    formNewRegionId,
  ]);

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Select Destination Location:
      </h2>
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location
          </div>
          <Controller
            control={form.control}
            name="newLocationId"
            render={({ field }) => (
              <div>
                <VirtualizedCombobox
                  disabled={disabled}
                  options={sortedRegionLocationOptions ?? []}
                  value={field.value?.toString()}
                  onSelect={(value) => {
                    field.onChange(Number(value));
                  }}
                  searchPlaceholder="Select destination location"
                />
                <p className="text-xs text-destructive">
                  {form.formState.errors.newLocationId?.message?.toString()}
                </p>
              </div>
            )}
          />
        </div>
      </div>
    </>
  );
};
