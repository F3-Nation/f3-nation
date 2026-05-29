import type { AdminRequestFormProps } from "./admin-request-form-props";
import {
  AoDetailsFields,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const EditAoAndLocationRequestForm = ({
  selectedAoLogoPreviewUrl,
  onAoLogoFileChange,
}: AdminRequestFormProps) => {
  return (
    <>
      <AoDetailsFields
        selectedAoLogoPreviewUrl={selectedAoLogoPreviewUrl}
        onAoLogoFileChange={onAoLogoFileChange}
      />
      <LocationDetailsFields />
      <SubmitterEmailField />
    </>
  );
};
