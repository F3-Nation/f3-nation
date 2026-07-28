import type { EditAOType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { EditAOSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProduction } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { AODetailsForm } from "../../forms/form-inputs/ao-details-form";
import { SubmitSection } from "../../forms/submit-section";

export const EditAoModal = ({
  data,
}: {
  data: DataType[ModalType.EDIT_AO];
}) => {
  const form = useForm({
    schema: EditAOSchema,
    defaultValues: data,
    mode: "onBlur",
  });

  const handleSubmission = async (values: EditAOType) => {
    return await client.request.submitEditAORequest(values);
  };

  return (
    <BaseModal title="Edit AO Details">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProduction && <FormDebugData />}
          <AODetailsForm<EditAOType> />
          <ContactDetailsForm<EditAOType> />
          <SubmitSection<EditAOType>
            mutationFn={handleSubmission}
            text="Update AO"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
