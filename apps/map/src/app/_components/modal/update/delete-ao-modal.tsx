import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { DeleteAOType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { DeleteAOSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
import { FormDebugData } from "../../forms/dev-debug-component";
import { ContactDetailsForm } from "../../forms/form-inputs/contact-details-form";
import { DeleteAoForm } from "../../forms/form-inputs/delete-ao-form";
import { SubmitSection } from "../../forms/submit-section";
import { BaseModal } from "../../modal/base-modal";

export const DeleteAoModal = ({
  data,
}: {
  data: DataType[ModalType.DELETE_AO];
}) => {
  const form = useForm<DeleteAOType>({
    resolver: zodResolver(DeleteAOSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  return (
    <BaseModal title="Delete AO">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}
          <DeleteAoForm<DeleteAOType> />
          <ContactDetailsForm<DeleteAOType> />
          <SubmitSection<DeleteAOType>
            mutationFn={(values) =>
              vanillaApi.request.submitDeleteAORequest(values)
            }
            text="Delete AO"
            className="bg-destructive hover:bg-destructive/80"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
