import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const DeleteAoRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalAoId = meta?.originalAoId;

  return (
    <>
      <DevMetaSummary
        title="Delete AO:"
        items={[{ label: "AO ID", value: originalAoId }]}
      />
      <SubmitterEmailField />
    </>
  );
};
