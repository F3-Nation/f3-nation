import { useEffect } from "react";
import { AlertTriangle, MapPin } from "lucide-react";

import { Button } from "@acme/ui/button";
import { Checkbox } from "@acme/ui/checkbox";

import { orpc, useQuery } from "~/orpc/react";
import { closeModal } from "~/utils/store/modal";
import { openRequestModal } from "~/utils/open-request-modal";
import {
  formatTime,
  getShortDayOfWeek,
} from "~/app/_components/map/location-edit-buttons";

/**
 * Lists the AOs (and their active events) that share a location, so the person
 * editing a location can see the blast radius before saving. When more than one
 * AO shares the location it renders a warning, a required acknowledgment
 * checkbox, and a per-AO "move to its own location" escape hatch.
 */
export const LinkedAosNotice = ({
  locationId,
  acknowledged,
  onAcknowledgeChange,
  onSharedChange,
}: {
  locationId: number | undefined;
  acknowledged: boolean;
  onAcknowledgeChange: (ack: boolean) => void;
  onSharedChange?: (state: { resolved: boolean; shared: boolean }) => void;
}) => {
  const { data, isLoading, isError, refetch } = useQuery({
    ...orpc.location.linkedAos.queryOptions({
      input: { locationId: locationId ?? 0 },
      enabled: locationId != null,
    }),
    throwOnError: false,
  });

  // Fail closed: `resolved` reflects the check's CURRENT state, not just
  // whether it ever succeeded — a later background refetch failure (e.g. on
  // window refocus, or a manual Retry) flips `isError` back to true and
  // `resolved` back to false. Reporting this unconditionally on every change
  // (not just when it becomes true) lets the parent re-close the gate it
  // already opened, instead of latching "resolved" permanently on the first
  // success.
  const resolved = locationId == null || (!isLoading && !isError && !!data);
  const isShared = (data?.totalAoCount ?? 0) > 1;

  useEffect(() => {
    onSharedChange?.({ resolved, shared: isShared });
  }, [resolved, isShared, onSharedChange]);

  if (locationId == null) return null;

  if (isError) {
    return (
      <div className="mt-2 mb-4 rounded-md border border-destructive p-3 text-sm text-destructive">
        Couldn’t check whether this location is shared, so saving is disabled to
        avoid unintentionally changing other AOs.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => void refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading || !data || data.aos.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 mb-4 rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        At this location:
      </h2>
      <ul className="space-y-2">
        {data.aos.map((ao) => {
          return (
            <li key={ao.aoId} className="text-sm">
              <div className="flex items-center gap-2">
                {ao.aoLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ao.aoLogo}
                    alt=""
                    className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <span className="font-medium">{ao.aoName}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {ao.events.map((ev) => {
                  const schedule = [
                    getShortDayOfWeek(ev.dayOfWeek),
                    formatTime(ev.startTime),
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <span
                      key={ev.id}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {ev.name ?? "Workout"}
                      {schedule ? ` (${schedule})` : ""}
                    </span>
                  );
                })}
              </div>
              {isShared ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => {
                    closeModal();
                    void openRequestModal({
                      type: "move_ao_to_different_location",
                      locationId,
                      aoId: ao.aoId,
                    });
                  }}
                >
                  <MapPin className="mr-1 h-3 w-3" />
                  Move {ao.aoName} to its own location…
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isShared ? (
        <div className="mt-3 rounded-md border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="space-y-2">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                This location is shared by {data.totalAoCount} AOs. Saving
                changes here (including moving the pin) will change it for{" "}
                <strong>all</strong> of them. To change only one AO, use “Move
                to its own location” above.
              </p>
              <label className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) =>
                    onAcknowledgeChange(checked === true)
                  }
                />
                I understand this edit affects all {data.totalAoCount} AOs
                listed above
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
