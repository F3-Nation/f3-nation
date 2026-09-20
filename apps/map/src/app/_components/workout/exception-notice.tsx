import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

import type { ExceptionNotice as Notice } from "~/utils/event-status-map";
import { dayjs } from "~/utils/frontendDayjs";
import { getStatusSolidBg } from "~/utils/map-status-colors";

/**
 * Announces the soonest upcoming exception next to a schedule that describes the
 * recurring event. Shared by the pin hover card and the details modal so the two
 * cannot drift into naming the same change differently.
 */
export function ExceptionNotice({
  notice,
  className,
}: {
  notice: Notice;
  className?: string;
}) {
  const time = notice.overrideStartTime
    ? dayjs(notice.overrideStartTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      )
    : null;

  return (
    <div className={cn("flex items-start gap-2 text-sm", className)}>
      {/* Decorative: the label beside it already names the status. The swatch
          is here to tie the notice to the pin color on the map. */}
      <div
        aria-hidden
        className={cn(
          "mt-[3px] h-3 w-3 flex-shrink-0 rounded-sm",
          getStatusSolidBg(notice.status),
        )}
      />
      <span>
        <span className="font-semibold">{notice.label}</span>{" "}
        {dayjs(notice.startDate).format("M/D")}
        {time ? `: ${time}` : null}
      </span>
    </div>
  );
}
