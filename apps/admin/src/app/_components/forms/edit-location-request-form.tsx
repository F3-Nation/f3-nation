import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import type { AdminRequestFormProps } from "./admin-request-form-props";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const EditLocationRequestForm = (_props: AdminRequestFormProps) => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalLocationId = meta?.originalLocationId;

  const { data: locationResponse } = useQuery(
    orpc.location.byId.queryOptions({
      input: { id: Number(originalLocationId) },
      enabled: originalLocationId != null,
    }),
  );
  const location = locationResponse?.location;
  const addressSummary = [
    location?.addressStreet,
    location?.addressCity,
    location?.addressState,
  ]
    .filter(Boolean)
    .join(", ");

  // Show every AO/event that shares this location so the reviewer sees the
  // blast radius of approving a shared-location edit.
  const { data: linked } = useQuery(
    orpc.location.linkedAos.queryOptions({
      input: { locationId: Number(originalLocationId) },
      enabled: originalLocationId != null,
    }),
  );

  return (
    <>
      <DevMetaSummary
        title="Edit Location:"
        items={[{ label: "Location ID", value: originalLocationId }]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Current Location:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Region
          </div>
          <div className="text-sm">{location?.regionName ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Address
          </div>
          <div className="text-sm">{addressSummary || "—"}</div>
        </div>
      </div>

      {linked && linked.totalAoCount > 1 ? (
        <div className="mt-3 rounded-md border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This location is shared by {linked.totalAoCount} AOs. Approving this
            edit changes it for all of them:{" "}
            {linked.aos.map((ao) => ao.aoName).join(", ")}.
          </p>
        </div>
      ) : null}

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        New Values:
      </h2>
      <LocationDetailsFields />
      <SubmitterEmailField />
    </>
  );
};
