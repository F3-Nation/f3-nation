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

      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
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
