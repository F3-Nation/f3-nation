import type { MoveAOToNewLocationType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { MoveAOToNewLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProduction } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { RegionAndAOSelector } from "../../forms/form-inputs/region-and-ao-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveAOToNewLocationModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_AO_TO_NEW_LOCATION];
}) => {
  const form = useForm({
    schema: MoveAOToNewLocationSchema,
    defaultValues: data,
  });

  return (
    <BaseModal title="Move AO to New Location">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProduction && <FormDebugData />}

          <RegionAndAOSelector<MoveAOToNewLocationType>
            title="Choose AO:"
            regionLabel="In Region:"
            aoLabel="AO to move:"
            aoFieldName="originalAoId"
            regionFieldName="originalRegionId"
            sameRegionMove={true}
          />
          <LocationDetailsForm<MoveAOToNewLocationType> />
          <ContactDetailsForm<MoveAOToNewLocationType> />
          <SubmitSection<MoveAOToNewLocationType>
            mutationFn={(values) =>
              client.request.submitMoveAOToNewLocationRequest(values)
            }
            text="Move AO to New Location"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
