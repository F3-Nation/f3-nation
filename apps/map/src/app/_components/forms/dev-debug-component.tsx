import { useFormContext } from "react-hook-form";

import { Button } from "@acme/ui/button";

interface DevLoadTestDataValues {
  id: string;
  eventName: string;
  eventDayOfWeek: string;
  submittedBy: string;
  aoLogo: string;
  aoName: string;
  locationAddress: string;
  locationAddress2: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  locationCountry: string;
  eventTypeIds: number[];
  eventStartTime: string;
  eventEndTime: string;
  eventDescription: string;
  locationDescription: string;
  aoWebsite: string;
}
export const DevLoadTestData = <_T extends DevLoadTestDataValues>() => {
  const form = useFormContext<DevLoadTestDataValues>();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        const values = form.getValues();
        !values.eventName && form.setValue("eventName", "Test Event");
        !values.eventDayOfWeek && form.setValue("eventDayOfWeek", "monday");
        !values.submittedBy && form.setValue("submittedBy", "test@test.com");
        !values.aoLogo &&
          form.setValue("aoLogo", "https://placehold.co/640x640");
        !values.aoName && form.setValue("aoName", "Test AO");
        !values.locationAddress &&
          form.setValue("locationAddress", "123 Test St");
        !values.locationAddress2 && form.setValue("locationAddress2", "Apt 1");
        !values.locationCity && form.setValue("locationCity", "Test City");
        !values.locationState && form.setValue("locationState", "CA");
        !values.locationZip && form.setValue("locationZip", "12345");
        !values.locationCountry &&
          form.setValue("locationCountry", "United States");
        !values.eventTypeIds?.length && form.setValue("eventTypeIds", [1]);
        !values.eventStartTime && form.setValue("eventStartTime", "0530");
        !values.eventEndTime && form.setValue("eventEndTime", "0615");
        !values.eventDescription &&
          form.setValue("eventDescription", "Test Description");
        !values.locationDescription &&
          form.setValue("locationDescription", "Test Location Description");
        !values.aoWebsite && form.setValue("aoWebsite", "https://test.com");
      }}
    >
      (DEV) Load Test Data
    </Button>
  );
};

interface FormDebugValues {
  id: string;
  originalEventId?: string;
  newEventId?: string;

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
  const formNewEventId = form.watch("newEventId");

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
        newEventId: {formNewEventId};
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
