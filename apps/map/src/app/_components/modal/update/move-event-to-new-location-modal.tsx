import type { MoveEventToNewLocationType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { MoveEventToNewLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProduction } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { RegionAOEventSelector } from "../../forms/form-inputs/region-ao-event-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveEventToNewLocationModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_EVENT_TO_NEW_LOCATION];
}) => {
  const form = useForm({
    schema: MoveEventToNewLocationSchema,
    defaultValues: data,
  });

  return (
    <BaseModal title="Move Event to New Location">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProduction && <FormDebugData />}

          <RegionAOEventSelector
            title="Event to move"
            regionLabel="In Region:"
            aoLabel="From AO (optional):"
            eventLabel="Event to move"
            eventFieldName="originalEventId"
            aoFieldName="originalAoId"
            regionFieldName="originalRegionId"
          />
          <LocationDetailsForm<MoveEventToNewLocationType> />
          <ContactDetailsForm<MoveEventToNewLocationType> />
          <SubmitSection<MoveEventToNewLocationType>
            mutationFn={(values) =>
              client.request.submitMoveEventToNewLocationRequest(values)
            }
            text="Move Event to New Location"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
