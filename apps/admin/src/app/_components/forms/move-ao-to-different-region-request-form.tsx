import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  RegionSelectField,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveAoToDifferentRegionRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");
  const originalAoId = meta?.originalAoId;
  const originalRegionId = meta?.originalRegionId;

  return (
    <>
      <DevMetaSummary
        title="Move AO:"
        items={[
          { label: "AO ID", value: originalAoId },
          { label: "Current Region ID", value: originalRegionId },
        ]}
      />

      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Destination Region:
      </h2>
      <div className="grid grid-cols-1 gap-4">
        <RegionSelectField searchPlaceholder="Select destination region" />
      </div>

      <SubmitterEmailField />
    </>
  );
};
