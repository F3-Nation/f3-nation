import { cn } from "@acme/ui";

import type { ScheduleDay } from "~/utils/ao-schedule-summary";
import { STRIP_DAYS } from "~/utils/ao-schedule-summary";
import { getStatusSolidBg } from "~/utils/map-status-colors";

/**
 * S M T W T F S with the meeting days filled in F3 red. A day with an upcoming
 * change takes its status color instead, and a dot marks a day whose start
 * time differs from the row's.
 */
export const DayStrip = ({
  days,
  className,
}: {
  days: ScheduleDay[];
  className?: string;
}) => {
  const meetingDays = days
    .filter((d) => d.meets)
    .map((d) => STRIP_DAYS.find((s) => s.day === d.day)?.short ?? d.day);
  return (
    <div
      className={cn("flex flex-row items-center gap-[3px]", className)}
      role="img"
      aria-label={
        meetingDays.length
          ? `Meets ${meetingDays.join(", ")}`
          : "No weekly days"
      }
    >
      {days.map((d) => (
        <span
          key={d.day}
          data-day={d.day}
          data-meets={d.meets}
          data-status={d.status ?? undefined}
          className={cn(
            "relative flex size-4 items-center justify-center rounded-[2px] text-[9px] leading-none font-bold",
            d.status
              ? [getStatusSolidBg(d.status), "text-white"]
              : d.meets
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            { "line-through": d.status === "closed" },
          )}
        >
          {d.letter}
          {d.differs ? (
            <span
              data-testid="day-differs"
              className="absolute -top-[3px] -right-[3px] size-[6px] rounded-full bg-white ring-1 ring-primary"
            />
          ) : null}
        </span>
      ))}
    </div>
  );
};
