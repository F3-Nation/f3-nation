import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveAoToNewLocationRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

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
      <LocationDetailsFields includeRegion />
      <SubmitterEmailField />
    </>
  );
};
