import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveEventToNewLocationRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalEventId = meta?.originalEventId;
  const originalLocationId = meta?.originalLocationId;

  return (
    <>
      <DevMetaSummary
        title="Move Workout:"
        items={[
          { label: "Workout ID", value: originalEventId },
          { label: "Current Location ID", value: originalLocationId },
        ]}
      />
      <LocationDetailsFields includeRegion />
      <SubmitterEmailField />
    </>
  );
};
