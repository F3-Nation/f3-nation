import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  LocationDetailsFields,
  LocationPickerField,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveAoToDifferentLocationRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const formLocationId = form.watch("locationId");
  const formLocationAddress = form.watch("locationAddress");
  const meta = form.watch("meta");

  const originalAoId = meta?.originalAoId;
  const originalLocationId = meta?.originalLocationId;

  const { data: orgResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: Number(originalAoId) },
      enabled: originalAoId != null,
    }),
  );
  const org = orgResponse?.org;

  const { data: currentLocationResponse } = useQuery(
    orpc.location.byId.queryOptions({
      input: { id: Number(originalLocationId) },
      enabled: originalLocationId != null,
    }),
  );
  const currentLocation = currentLocationResponse?.location;
  const currentAddressSummary = [
    currentLocation?.addressStreet,
    currentLocation?.addressCity,
    currentLocation?.addressState,
  ]
    .filter(Boolean)
    .join(", ");

  // When the user submitted "Create new location" from the map, the location
  // doesn't exist yet. The stored `locationId` falls back to `originalLocationId`
  // but `locationAddress` carries the new address details.
  const isNewLocation =
    formLocationId != null &&
    formLocationId === originalLocationId &&
    !!formLocationAddress;

  return (
    <>
      <DevMetaSummary
        title="Move AO:"
        items={[
          { label: "AO ID", value: originalAoId },
          { label: "Current Location ID", value: originalLocationId },
        ]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Currently Moving:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            AO Name
          </div>
          <div className="text-sm">{org?.name ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Current Location
          </div>
          <div className="text-sm">{currentAddressSummary || "—"}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Destination Location:
      </h2>
      <div className="grid grid-cols-1 gap-4">
        <LocationPickerField
          label="Destination Location"
          searchPlaceholder="Select destination location"
          newLocationLabel={isNewLocation ? formLocationAddress : null}
        />
      </div>

      {isNewLocation && <LocationDetailsFields />}

      <SubmitterEmailField />
    </>
  );
};
