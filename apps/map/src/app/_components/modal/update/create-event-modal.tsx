import type { CreateEventType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { CreateEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { FormDebugData } from "../../forms/dev-debug-component";
import { ContactDetailsForm } from "../../forms/form-inputs/contact-details-form";
import { EventDetailsForm } from "../../forms/form-inputs/event-details-form";
import { SubmitSection } from "../../forms/submit-section";
import { BaseModal } from "../base-modal";

export const CreateEventModal = ({
  data,
}: {
  data: DataType[ModalType.CREATE_EVENT];
}) => {
  const form = useForm({
    schema: CreateEventSchema,
    defaultValues: data,
  });

  return (
    <BaseModal title="Create New Event">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}
          <EventDetailsForm<CreateEventType> />
          <ContactDetailsForm<CreateEventType> />
          <SubmitSection<CreateEventType>
            mutationFn={(values) =>
              client.request.submitCreateEventRequest(values)
            }
            text="Create New Event"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
