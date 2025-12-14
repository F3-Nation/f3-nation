import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { DeleteEventType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { DeleteEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
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
  const form = useForm<DeleteEventType>({
    resolver: zodResolver(DeleteEventSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  return (
    <BaseModal title="Delete Event">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}
          <DeleteEventForm<DeleteEventType> />
          <ContactDetailsForm<DeleteEventType> />
          <SubmitSection<DeleteEventType>
            mutationFn={(values) =>
              vanillaApi.request.submitDeleteEventRequest(values)
            }
            text="Delete Event"
            className="bg-destructive hover:bg-destructive/80"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
