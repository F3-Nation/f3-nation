import { useFormContext } from "react-hook-form";

import type { RequestType } from "@acme/shared/app/enums";
import { Button } from "@acme/ui/button";

interface DevLoadTestDataValues {
  id: string;
  requestType: RequestType;
  submittedBy: string;
  eventName: string;
  eventDayOfWeek: string;
  eventStartTime: string;
  eventEndTime: string;
  eventDescription: string;
  eventTypeIds: number[];
  aoName: string;
  aoWebsite: string;
  locationAddress: string;
  locationAddress2: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  locationCountry: string;
  locationDescription: string;
}

type FieldGroup = "event" | "ao" | "location";

const FIELD_GROUPS_BY_REQUEST_TYPE: Partial<Record<RequestType, FieldGroup[]>> =
  {
    create_ao_and_location_and_event: ["event", "ao", "location"],
    move_event_to_new_ao: ["event", "ao", "location"],
    create_event: ["event"],
    edit_event: ["event"],
    edit_ao_and_location: ["ao", "location"],
    edit_ao: ["ao"],
    edit_location: ["location"],
    move_ao_to_new_location: ["location"],
    move_event_to_new_location: ["location"],
  };

function applyEventTestData(
  form: ReturnType<typeof useFormContext<DevLoadTestDataValues>>,
  values: DevLoadTestDataValues,
) {
  !values.eventName && form.setValue("eventName", "Test Event");
  !values.eventDayOfWeek && form.setValue("eventDayOfWeek", "monday");
  !values.eventStartTime && form.setValue("eventStartTime", "0530");
  !values.eventEndTime && form.setValue("eventEndTime", "0615");
  !values.eventDescription &&
    form.setValue("eventDescription", "Test Description");
  !values.eventTypeIds?.length && form.setValue("eventTypeIds", [1]);
}

function applyAoTestData(
  form: ReturnType<typeof useFormContext<DevLoadTestDataValues>>,
  values: DevLoadTestDataValues,
) {
  !values.aoName && form.setValue("aoName", "Test AO");
  !values.aoWebsite && form.setValue("aoWebsite", "https://test.com");
}

function applyLocationTestData(
  form: ReturnType<typeof useFormContext<DevLoadTestDataValues>>,
  values: DevLoadTestDataValues,
) {
  !values.locationAddress && form.setValue("locationAddress", "123 Test St");
  !values.locationAddress2 && form.setValue("locationAddress2", "Apt 1");
  !values.locationCity && form.setValue("locationCity", "Test City");
  !values.locationState && form.setValue("locationState", "CA");
  !values.locationZip && form.setValue("locationZip", "12345");
  !values.locationCountry && form.setValue("locationCountry", "United States");
  !values.locationDescription &&
    form.setValue("locationDescription", "Test Location Description");
}

const GROUP_APPLIERS: Record<FieldGroup, typeof applyEventTestData> = {
  event: applyEventTestData,
  ao: applyAoTestData,
  location: applyLocationTestData,
};

export const DevLoadTestData = <_T extends DevLoadTestDataValues>() => {
  const form = useFormContext<DevLoadTestDataValues>();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        const values = form.getValues();
        !values.submittedBy && form.setValue("submittedBy", "test@test.com");

        const groups = FIELD_GROUPS_BY_REQUEST_TYPE[values.requestType] ?? [];
        for (const group of groups) {
          GROUP_APPLIERS[group](form, values);
        }
      }}
    >
      (DEV) Load Test Data
    </Button>
  );
};

interface FormDebugValues {
  id: string;
  originalEventId?: string;

  originalLocationId?: string;
  newLocationId?: string;

  originalAoId?: string;
  newAoId?: string;

  originalRegionId?: string;
  newRegionId?: string;
}
export const FormDebugData = <_T extends FormDebugValues>() => {
  const form = useFormContext<FormDebugValues>();
  const formId = form.watch("id");
  const formOriginalEventId = form.watch("originalEventId");

  const formOriginalLocationId = form.watch("originalLocationId");
  const formNewLocationId = form.watch("newLocationId");

  const formOriginalAoId = form.watch("originalAoId");
  const formNewAoId = form.watch("newAoId");

  const formOriginalRegionId = form.watch("originalRegionId");
  const formNewRegionId = form.watch("newRegionId");
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">formId: {formId};</p>
      <p className="text-sm text-muted-foreground">
        originalEventId: {formOriginalEventId};
      </p>
      <p className="text-sm text-muted-foreground">
        originalLocationId: {formOriginalLocationId};
      </p>
      <p className="text-sm text-muted-foreground">
        newLocationId: {formNewLocationId};
      </p>
      <p className="text-sm text-muted-foreground">
        originalAoId: {formOriginalAoId};
      </p>
      <p className="text-sm text-muted-foreground">newAoId: {formNewAoId};</p>
      <p className="text-sm text-muted-foreground">
        originalRegionId: {formOriginalRegionId};
      </p>
      <p className="text-sm text-muted-foreground">
        newRegionId: {formNewRegionId};
      </p>
    </div>
  );
};
