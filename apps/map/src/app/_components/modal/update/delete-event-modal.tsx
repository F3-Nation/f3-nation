import type { DeleteEventType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { DeleteEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { isProduction } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { FormDebugData } from "../../forms/dev-debug-component";
import { ContactDetailsForm } from "../../forms/form-inputs/contact-details-form";
import { DeleteEventForm } from "../../forms/form-inputs/delete-event-form";
import { SubmitSection } from "../../forms/submit-section";
import { BaseModal } from "../base-modal";

export const DeleteEventModal = ({
  data,
}: {
  data: DataType[ModalType.DELETE_EVENT];
}) => {
  const form = useForm({
    schema: DeleteEventSchema,
    defaultValues: data,
    mode: "onBlur",
  });

  return (
    <BaseModal title="Delete Event">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProduction && <FormDebugData />}
          <DeleteEventForm />
          <ContactDetailsForm<DeleteEventType> />
          <SubmitSection<DeleteEventType>
            mutationFn={(values) =>
              client.request.submitDeleteEventRequest(values)
            }
            text="Delete Event"
            className="bg-destructive hover:bg-destructive/80"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
