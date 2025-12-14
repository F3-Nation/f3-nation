import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { EditAOAndLocationType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { EditAOAndLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
import { AODetailsForm } from "../../forms/form-inputs/ao-details-form";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const EditAoAndLocationModal = ({
  data,
}: {
  data: DataType[ModalType.EDIT_AO_AND_LOCATION];
}) => {
  const form = useForm<EditAOAndLocationType>({
    resolver: zodResolver(EditAOAndLocationSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  const handleSubmission = async (values: EditAOAndLocationType) => {
    if ("badImage" in values && values.badImage && !!values.aoLogo) {
      form.setError("aoLogo", { message: "Invalid image URL" });
      throw new Error("Invalid image URL");
    }

    return await vanillaApi.request.submitEditAOAndLocationRequest(values);
  };

  return (
    <BaseModal title="Edit AO Details">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}
          <AODetailsForm<EditAOAndLocationType> />
          <LocationDetailsForm<EditAOAndLocationType> />
          <ContactDetailsForm<EditAOAndLocationType> />
          <SubmitSection<EditAOAndLocationType>
            mutationFn={handleSubmission}
            text="Update AO and Location"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
