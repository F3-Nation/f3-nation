import type { schema } from "@acme/db";
import type { DayOfWeek } from "@acme/shared/app/enums";
import type { EventMeta, UpdateRequestMeta } from "@acme/shared/app/types";
import type { RequestInsertType } from "@acme/validators";

export type SelectedUpdateRequest = Omit<
  typeof schema.updateRequests.$inferSelect,
  "token"
>;

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
