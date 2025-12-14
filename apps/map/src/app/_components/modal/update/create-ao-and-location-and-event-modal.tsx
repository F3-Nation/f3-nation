import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { CreateAOAndLocationAndEventType } from "@acme/validators/request-schemas";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { Form } from "@acme/ui/form";
import { CreateAOAndLocationAndEventSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { client } from "~/orpc/client";
import { AODetailsForm } from "../../forms/form-inputs/ao-details-form";
import { EventDetailsForm } from "../../forms/form-inputs/event-details-form";
import { InRegionForm } from "../../forms/form-inputs/in-region-form";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const CreateAOAndLocationAndEventModal = ({
  data,
}: {
  data: DataType[ModalType.CREATE_AO_AND_LOCATION_AND_EVENT];
}) => {
  console.log("CreateAOAndLocationAndEventModal data", data);
  const form = useForm<CreateAOAndLocationAndEventType>({
    resolver: zodResolver(CreateAOAndLocationAndEventSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  const handleSubmission = async (values: CreateAOAndLocationAndEventType) => {
    if ("badImage" in values && values.badImage && !!values.aoLogo) {
      form.setError("aoLogo", { message: "Invalid image URL" });
      throw new Error("Invalid image URL");
    }

    return await client.request.submitCreateAOAndLocationAndEventRequest(
      values,
    );
  };

  return (
    <BaseModal title="New Location, AO & Event">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}
          <InRegionForm<CreateAOAndLocationAndEventType> />
          <LocationDetailsForm<CreateAOAndLocationAndEventType> />
          <AODetailsForm<CreateAOAndLocationAndEventType> />
          <EventDetailsForm<CreateAOAndLocationAndEventType> />
          <ContactDetailsForm<CreateAOAndLocationAndEventType> />
          <SubmitSection<CreateAOAndLocationAndEventType>
            mutationFn={handleSubmission}
            text="Create New Location, AO & Workout"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
