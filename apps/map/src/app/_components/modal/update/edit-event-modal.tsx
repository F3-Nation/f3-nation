import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { EditEventType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { EditEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
import { EventDetailsForm } from "../../forms/form-inputs/event-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const EditEventModal = ({
  data,
}: {
  data: DataType[ModalType.EDIT_EVENT];
}) => {
  const form = useForm<EditEventType>({
    resolver: zodResolver(EditEventSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  return (
    <BaseModal title="Edit workout details">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}
          <EventDetailsForm<EditEventType> />
          <ContactDetailsForm<EditEventType> />
          <SubmitSection<EditEventType>
            mutationFn={(values) =>
              vanillaApi.request.submitEditEventRequest(values)
            }
            text="Edit Workout Details"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
