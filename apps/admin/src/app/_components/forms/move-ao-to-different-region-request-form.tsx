import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  RegionSelectField,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveAoToDifferentRegionRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");
  const originalAoId = meta?.originalAoId;
  const originalRegionId = meta?.originalRegionId;

  const { data: orgResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: Number(originalAoId) },
      enabled: originalAoId != null,
    }),
  );
  const org = orgResponse?.org;

  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions({
      enabled: originalRegionId != null,
    }),
  );
  const currentRegionName = regionsResponse?.regions.find(
    (region) => region.id === originalRegionId,
  )?.name;

  return (
    <>
      <DevMetaSummary
        title="Move AO:"
        items={[
          { label: "AO ID", value: originalAoId },
          { label: "Current Region ID", value: originalRegionId },
        ]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Currently Moving:
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
            Current Region
          </div>
          <div className="text-sm">{currentRegionName ?? "—"}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Destination Region:
      </h2>
      <div className="grid grid-cols-1 gap-4">
        <RegionSelectField searchPlaceholder="Select destination region" />
      </div>

      <SubmitterEmailField />
    </>
  );
};
