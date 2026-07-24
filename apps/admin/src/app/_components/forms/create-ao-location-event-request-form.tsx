import type { AdminRequestFormProps } from "./admin-request-form-props";
import {
  AoDetailsFields,
  EventDetailsFields,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const CreateAoLocationEventRequestForm = ({
  selectedAoLogoPreviewUrl,
  onAoLogoFileChange,
}: AdminRequestFormProps) => {
  return (
    <>
      <EventDetailsFields />
      <AoDetailsFields
        selectedAoLogoPreviewUrl={selectedAoLogoPreviewUrl}
        onAoLogoFileChange={onAoLogoFileChange}
      />
      <LocationDetailsFields includeRegion />
      <SubmitterEmailField />
    </>
  );
};
