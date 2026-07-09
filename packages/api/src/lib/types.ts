import type { DayOfWeek } from "@acme/shared/app/enums";
import type { EventMeta, UpdateRequestMeta } from "@acme/shared/app/types";
import type { RequestInsertType } from "@acme/validators";

/**
 * Used to create an update request
 */
export type UpdateRequestData = Omit<
  RequestInsertType,
  "meta" | "eventMeta" | "eventDayOfWeek" | "regionId"
> & {
  reviewedBy?: string | null;
  meta?: UpdateRequestMeta | null;
  eventMeta?: EventMeta | null;
  eventDayOfWeek?: DayOfWeek | null;
};
