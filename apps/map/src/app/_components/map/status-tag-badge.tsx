import { cn } from "@acme/ui";

import type { StatusTag } from "~/utils/status-tag";
import { getStatusSolidBg } from "~/utils/map-status-colors";

/** The colored label for an upcoming change, in the pin's status color. */
export const StatusTagBadge = ({
  tag,
  className,
}: {
  tag: StatusTag;
  className?: string;
}) => (
  <span
    data-status={tag.status}
    className={cn(
      "w-fit rounded-[2px] px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider text-white uppercase",
      getStatusSolidBg(tag.status),
      className,
    )}
  >
    {tag.text}
  </span>
);
