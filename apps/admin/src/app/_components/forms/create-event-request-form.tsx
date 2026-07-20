import { useMemo } from "react";

import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  EventDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const CreateEventRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const requestType = form.watch("requestType");
  const meta = form.watch("meta");
  const aoName = form.watch("aoName");
  const locationAddress = form.watch("locationAddress");
  const locationCity = form.watch("locationCity");
  const locationState = form.watch("locationState");

  const isEdit = requestType === "edit_event";
  const originalEventId = meta?.originalEventId;

  const { data: eventResponse } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: Number(originalEventId) },
      enabled: isEdit && originalEventId != null,
    }),
  );
  const originalEvent = isEdit ? eventResponse?.event : undefined;

  const originalDayOfWeek = originalEvent?.dayOfWeek
    ? convertCase({
        str: originalEvent.dayOfWeek,
        fromCase: Case.LowerCase,
        toCase: Case.TitleCase,
      })
    : null;
  const originalTime = originalEvent?.startTime
    ? `${originalEvent.startTime}${originalEvent.endTime ? ` - ${originalEvent.endTime}` : ""}`
    : null;
  const originalEventTypes = originalEvent?.eventTypes
    .map((type) => type.eventTypeName)
    .join(", ");

  const locationSummary = useMemo(() => {
    return [locationAddress, locationCity, locationState]
      .filter(Boolean)
      .join(", ");
  }, [locationAddress, locationCity, locationState]);

  return (
    <>
      {isEdit && (
        <>
          <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
            Current Workout (before edit):
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Workout Name
              </div>
              <div className="text-sm">{originalEvent?.name ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Day of Week
              </div>
              <div className="text-sm">{originalDayOfWeek ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Time
              </div>
              <div className="text-sm">{originalTime ?? "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Event Types
              </div>
              <div className="text-sm">{originalEventTypes ?? "—"}</div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <div className="text-sm font-medium text-muted-foreground">
                Description
              </div>
              <div className="text-sm">{originalEvent?.description ?? "—"}</div>
            </div>
          </div>
        </>
      )}

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        {isEdit ? "Proposed Changes:" : "Workout Details:"}
      </h2>
      <EventDetailsFields />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Context (read-only):
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">AO</div>
          <div className="text-sm">{aoName ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Location
          </div>
          <div className="text-sm">{locationSummary || "—"}</div>
        </div>
      </div>

      <SubmitterEmailField />
    </>
  );
};
