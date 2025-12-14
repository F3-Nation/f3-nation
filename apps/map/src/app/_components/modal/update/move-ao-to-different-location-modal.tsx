import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MoveAOToDifferentLocationType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { MoveAOToDifferentLocationSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProd } from "~/trpc/util";
import { vanillaApi } from "~/trpc/vanilla";
import { ExistingLocationPickerForm } from "../../forms/form-inputs/existing-location-picker-form";
import { SubmitSection } from "../../forms/submit-section";

export const MoveAOToDifferentLocationModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_AO_TO_DIFFERENT_LOCATION];
}) => {
  const form = useForm<MoveAOToDifferentLocationType>({
    resolver: zodResolver(MoveAOToDifferentLocationSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  // TODO: Show the information about the ao that is being moved
  return (
    <BaseModal title="Move AO to Different Location">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProd && <FormDebugData />}
          <div>
            <p>Moving AO ID: {data?.originalAoId}</p>
            <p>From Location ID: {data?.originalLocationId}</p>
            <p>To Location ID: {data?.newLocationId}</p>
            <p>Original Region ID: {data?.originalRegionId}</p>
            <p>Original AO ID: {data?.originalAoId}</p>
          </div>
          <ExistingLocationPickerForm<MoveAOToDifferentLocationType> region="originalRegion" />
          <ContactDetailsForm<MoveAOToDifferentLocationType> />
          <SubmitSection<MoveAOToDifferentLocationType>
            mutationFn={(values) =>
              vanillaApi.request.submitMoveAOToDifferentLocationRequest(values)
            }
            text="Move AO to Different Location"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
