import { useMemo } from "react";

import { useUpdateLocationFormContext } from "~/utils/forms";
import {
  EventDetailsFields,
  SubmitterEmailField,
} from "./admin-request-form-sections";

export const CreateEventRequestForm = () => {
  const form = useUpdateLocationFormContext();
  const aoName = form.watch("aoName");
  const locationAddress = form.watch("locationAddress");
  const locationCity = form.watch("locationCity");
  const locationState = form.watch("locationState");

  const locationSummary = useMemo(() => {
    return [locationAddress, locationCity, locationState]
      .filter(Boolean)
      .join(", ");
  }, [locationAddress, locationCity, locationState]);

  return (
    <>
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
