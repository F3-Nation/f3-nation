"use client";

import { TriangleAlert } from "lucide-react";

import { cn } from "@acme/ui";

import { useUpcomingInstances } from "~/utils/hooks/use-upcoming-instances";

/**
 * Shown when the schedule-exception fetch failed, on the surfaces whose only
 * other signal is an absence: an unflagged pin and an empty "upcoming changes"
 * list both read as "running as scheduled". Someone acting on that could show
 * up to a cancelled workout, so the failure has to say so out loud.
 *
 * Deliberately non-blocking — everything else on the map is still accurate, and
 * the query it reports on is shared, so this adds no fetch of its own.
 */
export const ScheduleChangesNotice = ({
  className,
}: {
  className?: string;
}) => {
  const { isUnavailable } = useUpcomingInstances();

  if (!isUnavailable) return null;

  return (
    <div
      role="status"
      className={cn(
        "z-10 m-2 flex w-max max-w-[calc(100vw-1rem)] items-center gap-1.5 rounded-md border border-border bg-background/90 p-1 px-2 text-xs text-foreground shadow-xs",
        className,
      )}
    >
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span>Some schedule changes may not be showing</span>
    </div>
  );
};
