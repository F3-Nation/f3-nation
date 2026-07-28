import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  DevMetaSummary,
  LocationDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const MoveEventToNewLocationRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const meta = form.watch("meta");

  const originalEventId = meta?.originalEventId;
  const originalLocationId = meta?.originalLocationId;

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

  const { data: currentLocationResponse } = useQuery(
    orpc.location.byId.queryOptions({
      input: { id: Number(originalLocationId) },
      enabled: originalLocationId != null,
    }),
  );
  const currentLocation = currentLocationResponse?.location;
  const currentAddressSummary = [
    currentLocation?.addressStreet,
    currentLocation?.addressCity,
    currentLocation?.addressState,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <DevMetaSummary
        title="Move Workout:"
        items={[
          { label: "Workout ID", value: originalEventId },
          { label: "Current Location ID", value: originalLocationId },
        ]}
      />

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Currently Moving:
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
        <div className="space-y-1 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Current Location
          </div>
          <div className="text-sm">{currentAddressSummary || "—"}</div>
        </div>
      </div>

      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        New Location:
      </h2>
      <LocationDetailsFields includeRegion />
      <SubmitterEmailField />
    </>
  );
};
