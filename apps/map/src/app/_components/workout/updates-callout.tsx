import { CalendarClock } from "lucide-react";

import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

import { dayjs } from "~/utils/frontendDayjs";
import { instanceMapStatus, statusLabel } from "~/utils/event-status-map";
import { getStatusSolidBg } from "~/utils/map-status-colors";

/** The instance fields a row reads. */
export interface UpdateInstance {
  id: number;
  startDate: string;
  startTime: string | null;
  seriesException: string | null;
}

function formatUpdateRow(instance: UpdateInstance) {
  const date = dayjs(instance.startDate).format("M/D");
  // A closure has no meaningful time — the row still carries whatever the
  // instance stored, and printing it would read as "come at 6:15" for a workout
  // that is not happening.
  const time =
    instance.seriesException !== "closed" && instance.startTime
      ? dayjs(instance.startTime, START_END_TIME_DB_FORMAT).format(
          START_END_TIME_DISPLAY_FORMAT,
        )
      : null;
  // The workout name is deliberately absent: every row carries the same one, and
  // it is already the modal's title a line above.
  return time ? `${date} at ${time}` : date;
}

/**
 * The upcoming exceptions for the selected workout, as a callout rather than a
 * data section — this is an interruption to the schedule shown below it, not
 * another field describing the schedule.
 *
 * The card itself is deliberately neutral. Tinting it to one of the changes
 * would make the whole block read as that status, when the list can hold
 * several; the per-row swatches carry the status color, matching the pins.
 *
 * `instances` must be sorted soonest-first.
 */
export function UpdatesCallout({
  instances,
}: {
  instances: readonly UpdateInstance[];
}) {
  if (instances.length === 0) return null;

  const heading =
    instances.length === 1
      ? "1 upcoming change"
      : `${instances.length} upcoming changes`;

  return (
    <div
      role="alert"
      className="mt-2 rounded-lg border border-muted bg-muted/30 p-3 text-foreground"
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{heading}</div>
          <div className="mt-2 flex flex-col gap-1">
            {instances.map((instance) => {
              const status = instanceMapStatus(instance.seriesException);
              return (
                <div
                  key={instance.id}
                  className="flex items-center gap-2 text-sm"
                >
                  {/* Decorative: the label beside it names the status. The
                      swatch is the row's tie back to its map pin color. */}
                  <div
                    aria-hidden
                    className={cn(
                      "h-3 w-3 flex-shrink-0 rounded-sm",
                      getStatusSolidBg(status),
                    )}
                  />
                  <span>
                    <span className="font-semibold">{statusLabel(status)}</span>
                    {" — "}
                    {formatUpdateRow(instance)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
