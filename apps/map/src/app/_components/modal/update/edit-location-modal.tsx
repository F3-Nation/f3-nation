import { useState } from "react";

import type { EditLocationType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { EditLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { LinkedAosNotice } from "~/app/_components/forms/linked-aos-notice";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProduction } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const EditLocationModal = ({
  data,
}: {
  data: DataType[ModalType.EDIT_LOCATION];
}) => {
  const form = useForm({
    schema: EditLocationSchema,
    defaultValues: data,
    mode: "onBlur",
  });

  // Fail closed: the shared-location check must resolve before submission is
  // allowed. LinkedAosNotice reports { resolved, shared } on every change
  // (not just the first success), so a later refetch failure re-closes this
  // gate instead of leaving it permanently open once it's opened once.
  const [sharedCheck, setSharedCheck] = useState({
    resolved: false,
    shared: false,
  });
  const [acknowledged, setAcknowledged] = useState(false);

  const handleSubmission = async (values: EditLocationType) => {
    // Send the acknowledgment so the server-side shared-location guard
    // (handleEditLocation) accepts an acknowledged edit; the client gate alone
    // is bypassable.
    return await client.request.submitEditLocationRequest({
      ...values,
      acknowledgeShared: acknowledged,
    });
  };

  return (
    <BaseModal title="Edit Location">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProduction && <FormDebugData />}
          <LinkedAosNotice
            locationId={data.originalLocationId}
            acknowledged={acknowledged}
            onAcknowledgeChange={setAcknowledged}
            onSharedChange={setSharedCheck}
          />
          <LocationDetailsForm<EditLocationType> />
          <ContactDetailsForm<EditLocationType> />
          <SubmitSection<EditLocationType>
            mutationFn={handleSubmission}
            text="Update Location"
            disabled={
              !sharedCheck.resolved || (sharedCheck.shared && !acknowledged)
            }
          />
        </form>
      </Form>
    </BaseModal>
  );
};
