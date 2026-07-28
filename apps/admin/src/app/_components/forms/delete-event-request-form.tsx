import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const DeleteEventRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalEventId = meta?.originalEventId;

  const { data: eventResponse } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: Number(originalEventId) },
      enabled: originalEventId != null,
    }),
  );
  const event = eventResponse?.event;

  const dayOfWeek = event?.dayOfWeek
    ? convertCase({
        str: event.dayOfWeek,
        fromCase: Case.LowerCase,
        toCase: Case.TitleCase,
      })
    : null;
  const time = event?.startTime
    ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ""}`
    : null;
  const eventTypes = event?.eventTypes
    .map((type) => type.eventTypeName)
    .join(", ");
  const regions = event?.regions.map((region) => region.regionName).join(", ");

  return (
    <>
      <DevMetaSummary
        title="Delete Workout:"
        items={[{ label: "Workout ID", value: originalEventId }]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Event Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Workout Name
          </div>
          <div className="text-sm">{event?.name ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">AO</div>
          <div className="text-sm">{event?.location ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Day of Week
          </div>
          <div className="text-sm">{dayOfWeek ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">Time</div>
          <div className="text-sm">{time ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Event Types
          </div>
          <div className="text-sm">{eventTypes ?? "—"}</div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Region
          </div>
          <div className="text-sm">{regions ?? "—"}</div>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Description
          </div>
          <div className="text-sm">{event?.description ?? "—"}</div>
        </div>
      </div>

      <SubmitterEmailField />
    </>
  );
};
