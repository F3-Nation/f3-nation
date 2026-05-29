import { useMemo } from "react";

import { isTruthy } from "@acme/shared/common/functions";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveAoToDifferentLocationRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const formLocationId = form.watch("locationId");
  const meta = form.watch("meta");

  const { data: locations } = useQuery(orpc.location.all.queryOptions());

  const locationOptions = useMemo(() => {
    return (
      locations?.locations
        .filter(
          (location) => !formRegionId || location.regionId === formRegionId,
        )
        .sort((a, b) => a.locationName.localeCompare(b.locationName))
        .map((location) => ({
          labelComponent: (
            <span>
              {`${location.locationName}${location.regionName ? ` (${location.regionName})` : ""}`}
              <span className="text-foreground/30">{` ${[
                location.addressStreet,
                location.addressStreet2,
                location.addressCity,
                location.addressState,
                location.addressZip,
                location.addressCountry,
              ]
                .filter(isTruthy)
                .join(", ")}`}</span>
            </span>
          ),
          label: `${location.locationName}${location.regionName ? ` (${location.regionName})` : ""} ${[
            location.addressStreet,
            location.addressStreet2,
            location.addressCity,
            location.addressState,
            location.addressZip,
            location.addressCountry,
          ]
            .filter(isTruthy)
            .join(", ")}`,
          value: location.id.toString(),
        })) ?? []
    );
  }, [locations?.locations, formRegionId]);

  const originalAoId = meta?.originalAoId;
  const originalLocationId = meta?.originalLocationId;

  return (
    <>
      <DevMetaSummary
        title="Move AO:"
        items={[
          { label: "AO ID", value: originalAoId },
          { label: "Current Location ID", value: originalLocationId },
        ]}
      />

      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Destination Location:
      </h2>
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Existing Location
          </div>
          <VirtualizedCombobox
            key={formLocationId?.toString()}
            options={locationOptions}
            value={formLocationId?.toString()}
            onSelect={(item) => {
              const location = locations?.locations.find(
                ({ id }) => id.toString() === item,
              );

              form.setValue("locationId", location?.id ?? null);
              if (!location) return;

              form.setValue("locationDescription", location.description ?? "");
              form.setValue("locationAddress", location.addressStreet);
              form.setValue("locationAddress2", location.addressStreet2);
              form.setValue("locationCity", location.addressCity);
              form.setValue("locationState", location.addressState);
              form.setValue("locationZip", location.addressZip);
              form.setValue("locationCountry", location.addressCountry);
              form.setValue("locationLat", location.latitude);
              form.setValue("locationLng", location.longitude);
              form.setValue("regionId", location.regionId ?? formRegionId);
            }}
            searchPlaceholder="Select destination location"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationId?.message}
          </p>
        </div>
      </div>

      <SubmitterEmailField />
    </>
  );
};
