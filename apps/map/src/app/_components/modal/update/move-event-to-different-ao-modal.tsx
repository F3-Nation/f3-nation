import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MoveEventToDifferentAOType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { MoveEventToDifferentAOSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
import { RegionAndAOSelector } from "../../forms/form-inputs/region-and-ao-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveEventToDifferentAoModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_EVENT_TO_DIFFERENT_AO];
}) => {
  const form = useForm<MoveEventToDifferentAOType>({
    resolver: zodResolver(MoveEventToDifferentAOSchema),
    defaultValues: data,
  });

  console.log("MoveEventToDifferentAoModal data", data);
  console.log("MoveEventToDifferentAoModal form", form.watch());

  return (
    <BaseModal title="Move Event to Different AO">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}

          <div>
            <p>Moving Event ID: {data?.originalEventId}</p>
            <p>From AO ID: {data?.originalAoId}</p>
            <p>To AO ID: {data?.newAoId}</p>
            <p>Original Region ID: {data?.originalRegionId}</p>
          </div>

          <RegionAndAOSelector<MoveEventToDifferentAOType>
            title="Destination AO"
            regionLabel="In Region:"
            aoLabel="To AO"
          />
          <ContactDetailsForm<MoveEventToDifferentAOType> />
          <SubmitSection<MoveEventToDifferentAOType>
            mutationFn={(values) =>
              vanillaApi.request.submitMoveEventToDifferentAoRequest(values)
            }
            text="Move Event to Different AO"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
