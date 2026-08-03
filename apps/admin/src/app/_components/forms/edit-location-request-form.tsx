import { useEffect } from "react";

import { Checkbox } from "@acme/ui/checkbox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import type { AdminRequestFormProps } from "./admin-request-form-props";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const EditLocationRequestForm = ({
  onApprovalGateChange,
}: AdminRequestFormProps) => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");
  const acknowledged = form.watch("acknowledgeShared") ?? false;

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
  const {
    data: linked,
    isLoading: linkedIsLoading,
    isError: linkedIsError,
    refetch: refetchLinked,
  } = useQuery({
    ...orpc.location.linkedAos.queryOptions({
      input: { locationId: Number(originalLocationId) },
      enabled: originalLocationId != null,
    }),
    throwOnError: false,
  });

  // Fail closed: only report a resolved verdict once the check has actually
  // succeeded — same contract as the map app's LinkedAosNotice/EditLocationModal.
  // Approving while this is still loading (or errored) would let a reviewer
  // approve a shared-location edit without ever having seen the warning.
  const resolved =
    originalLocationId == null ||
    (!linkedIsLoading && !linkedIsError && !!linked);
  const isShared = (linked?.totalAoCount ?? 0) > 1;

  useEffect(() => {
    onApprovalGateChange?.(!resolved || (isShared && !acknowledged));
  }, [resolved, isShared, acknowledged, onApprovalGateChange]);

  // Reset the acknowledgment whenever the request (and thus the location
  // being reviewed) changes, so a previous approval doesn't silently carry
  // over.
  useEffect(() => {
    form.setValue("acknowledgeShared", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalLocationId]);

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

      {linkedIsError ? (
        <div className="mt-3 rounded-md border border-destructive p-3 text-sm text-destructive">
          Couldn’t check whether this location is shared, so approving is
          disabled to avoid unintentionally changing other AOs.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void refetchLinked()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {isShared ? (
        <div className="mt-3 rounded-md border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
          <div className="space-y-2">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              This location is shared by {linked?.totalAoCount} AOs. Approving
              this edit changes it for all of them:{" "}
              {linked?.aos.map((ao) => ao.aoName).join(", ")}.
            </p>
            <label className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(checked) =>
                  form.setValue("acknowledgeShared", checked === true)
                }
              />
              I understand this edit affects all {linked?.totalAoCount} AOs
              listed above
            </label>
          </div>
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
