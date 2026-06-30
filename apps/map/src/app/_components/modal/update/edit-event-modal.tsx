import type { EditEventType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { EditEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { EventDetailsForm } from "../../forms/form-inputs/event-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const EditEventModal = ({
  data,
}: {
  data: DataType[ModalType.EDIT_EVENT];
}) => {
  const form = useForm({
    schema: EditEventSchema,
    defaultValues: data,
    mode: "onBlur",
  });

  const handleSubmission = async (values: EditEventType) => {
    return await client.request.submitEditEventRequest(values);
  };

  return (
    <BaseModal title="Edit workout details">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}
          <EventDetailsForm<EditEventType> />
          <ContactDetailsForm<EditEventType> />
          <SubmitSection<EditEventType>
            mutationFn={handleSubmission}
            text="Edit Workout Details"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
