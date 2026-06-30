import { useEffect, useMemo } from "react";
import { PlusCircle } from "lucide-react";
import { Controller, useFormContext } from "react-hook-form";

import { isTruthy } from "@acme/shared/common/functions";

import { orpc, useQuery } from "~/orpc/react";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

const NEW_LOCATION_VALUE = "new";

interface ExistingLocationPickerFormValues {
  newLocationId: number | null;
  originalLocationId: number;
  originalRegionId?: number | null;
  newRegionId?: number | null;
}

export const ExistingLocationPickerForm = (params: {
  region: "originalRegion" | "newRegion";
}) => {
  const form = useFormContext<ExistingLocationPickerFormValues>();
  const formNewRegionId = form.watch("newRegionId");
  const formOriginalRegionId = form.watch("originalRegionId");
  const formNewLocationId = form.watch("newLocationId");

  const disabled =
    (params.region === "newRegion" && !formNewRegionId) ||
    (params.region === "originalRegion" && !formOriginalRegionId);

  // Get location data
  const { data: locations } = useQuery(orpc.location.all.queryOptions());

  const sortedRegionLocationOptions = useMemo(() => {
    const newLocationOption = {
      labelComponent: (
        <span className="flex items-center gap-2 font-medium text-primary">
          <PlusCircle className="size-4" />
          Create new location
        </span>
      ),
      label: "Create new location",
      value: NEW_LOCATION_VALUE,
      regionId: null,
      pinned: true,
    };

    const existingLocations =
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
        })) ?? [];

    return [newLocationOption, ...existingLocations];
  }, [
    locations?.locations,
    params.region,
    formOriginalRegionId,
    formNewRegionId,
  ]);

  // When the region changes the filtered options change too; clear a selected
  // location that no longer belongs to the region so an invalid
  // location/region pair can't be submitted. A null id means "create new
  // location" and is always valid. Wait for location data so a pre-filled id
  // isn't wiped before the options have loaded.
  useEffect(() => {
    if (formNewLocationId == null || !locations?.locations) return;
    const stillValid = sortedRegionLocationOptions.some(
      (option) => option.value === formNewLocationId.toString(),
    );
    if (!stillValid) {
      form.setValue("newLocationId", null);
    }
  }, [
    formNewLocationId,
    locations?.locations,
    sortedRegionLocationOptions,
    form,
  ]);

  return (
    <>
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
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
                  options={sortedRegionLocationOptions}
                  value={
                    field.value === null
                      ? NEW_LOCATION_VALUE
                      : field.value?.toString()
                  }
                  onSelect={(value) => {
                    if (value === NEW_LOCATION_VALUE) {
                      field.onChange(null);
                    } else {
                      field.onChange(Number(value));
                    }
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
