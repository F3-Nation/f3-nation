import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const DeleteAoRequestForm = () => {
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

  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions({ enabled: org?.parentId != null }),
  );
  const regionName = regionsResponse?.regions.find(
    (region) => region.id === org?.parentId,
  )?.name;

  const { data: locationResponse } = useQuery(
    orpc.location.byId.queryOptions({
      input: { id: Number(org?.defaultLocationId) },
      enabled: org?.defaultLocationId != null,
    }),
  );
  const location = locationResponse?.location;
  const locationSummary = [location?.addressCity, location?.addressState]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <DevMetaSummary
        title="Delete AO:"
        items={[{ label: "AO ID", value: originalAoId }]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        AO Being Deleted:
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
            Region
          </div>
          <div className="text-sm">{regionName ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Website
          </div>
          <div className="text-sm">{org?.website ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Location
          </div>
          <div className="text-sm">{locationSummary || "—"}</div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Description
          </div>
          <div className="text-sm">{org?.description ?? "—"}</div>
        </div>
      </div>

      <SubmitterEmailField />
    </>
  );
};
