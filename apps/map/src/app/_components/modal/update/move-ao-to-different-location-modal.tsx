import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MoveAOToDifferentLocationType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { MoveAOToDifferentLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { ExistingLocationPickerForm } from "../../forms/form-inputs/existing-location-picker-form";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const MoveAOToDifferentLocationModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_AO_TO_DIFFERENT_LOCATION];
}) => {
  const form = useForm<MoveAOToDifferentLocationType>({
    resolver: zodResolver(MoveAOToDifferentLocationSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  const formNewLocationId = form.watch("newLocationId");

  return (
    <BaseModal title="Move AO to Different Location">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}
          <ExistingLocationPickerForm<MoveAOToDifferentLocationType> region="originalRegion" />
          {!formNewLocationId && (
            <LocationDetailsForm<MoveAOToDifferentLocationType> />
          )}
          <ContactDetailsForm<MoveAOToDifferentLocationType> />
          <SubmitSection<MoveAOToDifferentLocationType>
            mutationFn={(values) =>
              client.request.submitMoveAOToDifferentLocationRequest(values)
            }
            text="Move AO to Different Location"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
