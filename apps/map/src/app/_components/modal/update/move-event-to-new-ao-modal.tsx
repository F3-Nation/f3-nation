import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MoveEventToNewAOType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { MoveEventToNewAOSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { ExistingLocationPickerForm } from "~/app/_components/forms/form-inputs/existing-location-picker-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { AODetailsForm } from "../../forms/form-inputs/ao-details-form";
import { LocationDetailsForm } from "../../forms/form-inputs/location-details-form";
import { RegionSelector } from "../../forms/form-inputs/region-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveEventToNewAoModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_EVENT_TO_NEW_AO];
}) => {
  const form = useForm<MoveEventToNewAOType>({
    resolver: zodResolver(MoveEventToNewAOSchema),
    defaultValues: data,
  });

  const formNewLocationId = form.watch("newLocationId");

  return (
    <BaseModal title="Move Event to New AO">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}

          <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
            Destination Region:
          </h2>
          <div className="flex flex-row flex-wrap gap-4">
            <RegionSelector<MoveEventToNewAOType>
              label="Region"
              fieldName="newRegionId"
            />
          </div>
          <AODetailsForm<MoveEventToNewAOType> />
          <ExistingLocationPickerForm region="newRegion" />
          {!formNewLocationId && <LocationDetailsForm<MoveEventToNewAOType> />}
          <ContactDetailsForm<MoveEventToNewAOType> />
          <SubmitSection<MoveEventToNewAOType>
            mutationFn={(values) =>
              client.request.submitMoveEventToNewAoRequest(values)
            }
            text="Move Event to New AO"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
