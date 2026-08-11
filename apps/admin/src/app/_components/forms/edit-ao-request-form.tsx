import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import type { AdminRequestFormProps } from "./admin-request-form-props";
import {
  AoDetailsFields,
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const EditAoRequestForm = ({
  selectedAoLogoPreviewUrl,
  onAoLogoFileChange,
}: AdminRequestFormProps) => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalAoId = meta?.originalAoId;

  const { data: orgResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: Number(originalAoId) },
      enabled: originalAoId != null,
    }),
  );
  const org = orgResponse?.org;

  return (
    <>
      <DevMetaSummary
        title="Edit AO:"
        items={[{ label: "AO ID", value: originalAoId }]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Current AO:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            AO Name
          </div>
          <div className="text-sm">{org?.name ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Website
          </div>
          <div className="text-sm">{org?.website ?? "—"}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        New Values:
      </h2>
      <AoDetailsFields
        selectedAoLogoPreviewUrl={selectedAoLogoPreviewUrl}
        onAoLogoFileChange={onAoLogoFileChange}
      />
      <SubmitterEmailField />
    </>
  );
};
