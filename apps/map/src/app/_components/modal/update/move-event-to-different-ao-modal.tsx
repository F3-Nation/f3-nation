import type { MoveEventToDifferentAOType } from "@acme/validators/request-schemas";
import { Form, useForm } from "@acme/ui/form";
import { MoveEventToDifferentAOSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { RegionAndAOSelector } from "../../forms/form-inputs/region-and-ao-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveEventToDifferentAoModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_EVENT_TO_DIFFERENT_AO];
}) => {
  const form = useForm({
    schema: MoveEventToDifferentAOSchema,
    defaultValues: data,
  });

  return (
    <BaseModal title="Move Event to Different AO">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}

          <RegionAndAOSelector<MoveEventToDifferentAOType>
            title="Destination AO"
            regionLabel="In Region:"
            aoLabel="To AO"
          />
          <ContactDetailsForm<MoveEventToDifferentAOType> />
          <SubmitSection<MoveEventToDifferentAOType>
            mutationFn={(values) =>
              client.request.submitMoveEventToDifferentAoRequest(values)
            }
            text="Move Event to Different AO"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
