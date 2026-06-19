import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { MoveAoToDifferentRegionType } from "@acme/validators/request-schemas";
import { Form } from "@acme/ui/form";
import { MoveAOToDifferentRegionSchema } from "@acme/validators/request-schemas";

import type { DataType, ModalType } from "~/utils/store/modal";
import { FormDebugData } from "~/app/_components/forms/dev-debug-component";
import { ContactDetailsForm } from "~/app/_components/forms/form-inputs/contact-details-form";
import { BaseModal } from "~/app/_components/modal/base-modal";
import { isProductionNodeEnv } from "@acme/shared/common/constants";
import { client } from "~/orpc/client";
import { RegionSelector } from "../../forms/form-inputs/region-selector";
import { SubmitSection } from "../../forms/submit-section";

export const MoveAOToDifferentRegionModal = ({
  data,
}: {
  data: DataType[ModalType.MOVE_AO_TO_DIFFERENT_REGION];
}) => {
  const form = useForm<MoveAoToDifferentRegionType>({
    resolver: zodResolver(MoveAOToDifferentRegionSchema),
    defaultValues: data,
    mode: "onBlur",
  });

  return (
    <BaseModal title="Move to different region">
      <Form {...form}>
        <form className="w-[inherit] overflow-x-hidden p-0.5">
          {!isProductionNodeEnv && <FormDebugData />}
          <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
            Region Details:
          </h2>
          <div className="flex flex-row flex-wrap gap-4">
            <RegionSelector label="Region" />
          </div>
          <ContactDetailsForm<MoveAoToDifferentRegionType> />
          <SubmitSection<MoveAoToDifferentRegionType>
            mutationFn={(values) =>
              client.request.submitMoveAOToDifferentRegionRequest(values)
            }
            text="Move AO to Different Region"
          />
        </form>
      </Form>
    </BaseModal>
  );
};
