import lt from "lodash/lt";
import { X } from "lucide-react";
import { useMemo } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";

import { DayOfWeek } from "@acme/shared/app/enums";
import { Case } from "@acme/shared/common/enums";
import { convertCase, isTruthy } from "@acme/shared/common/functions";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { MultiSelect } from "@acme/ui/multi-select";
import { ControlledSelect } from "@acme/ui/select";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { RequestInsertSchema } from "@acme/validators";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import { scaleAndCropImage } from "~/utils/image/scale-and-crop-image";
import { uploadLogo } from "~/utils/image/upload-logo";
import { mapStore } from "~/utils/store/map";
import { DebouncedImage } from "../debounced-image";
import { CountrySelect } from "../modal/country-select";
import { ControlledTimeInput } from "../time-input";
import { VirtualizedCombobox } from "../virtualized-combobox";

export const UpdateLocationSchema = RequestInsertSchema.extend({
  badImage: z.boolean().default(false),
});

type UpdateLocationSchema = z.infer<typeof UpdateLocationSchema>;

export const LocationEventForm = ({
  isAdminForm = false,
}: {
  isAdminForm?: boolean;
}) => {
  const form = useUpdateLocationFormContext();
  const formId = form.watch("id");
  const formRegionId = form.watch("regionId");
  const formLocationId = form.watch("locationId");
  const formAoId = form.watch("aoId");
  console.log("form eventTypeIds", form.getValues().eventTypeIds);

  // Get form values
  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions(),
  );
  const regions = regionsResponse?.regions;
  const { data: allAoData } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );
  const { data: locations } = useQuery(orpc.location.all.queryOptions());
  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        orgIds: formRegionId ? [formRegionId] : [],
      },
    }),
  );
  const aos = useMemo(() => allAoData?.orgs, [allAoData]);

  const sortedRegionLocationOptions = useMemo(() => {
    return locations?.locations
      ?.filter((l) => !formRegionId || l.regionId === formRegionId)
      ?.sort((a, b) =>
        a.regionId === formRegionId && b.regionId !== formRegionId
          ? -1
          : a.regionId !== formRegionId && b.regionId === formRegionId
            ? 1
            : a.locationName.localeCompare(b.locationName),
      )
      ?.map((l) => ({
        labelComponent: (
          <span>
            {`${l.locationName}${l.regionName ? ` (${l.regionName})` : ""}`}
            <span className="text-foreground/30">{` ${[l.addressStreet, l.addressStreet2, l.addressCity, l.addressState, l.addressZip, l.addressCountry].filter(isTruthy).join(", ")}`}</span>
          </span>
        ),
        label: `${l.locationName}${l.regionName ? ` (${l.regionName})` : ""} ${[l.addressStreet, l.addressStreet2, l.addressCity, l.addressState, l.addressZip, l.addressCountry].filter(isTruthy).join(", ")}`,
        value: l.id.toString(),
        regionId: l.regionId,
      }));
  }, [locations, formRegionId]);

  const sortedRegionAoOptions = useMemo(() => {
    return (
      aos
        ?.filter((a) => !formRegionId || a.parentId === formRegionId)
        ?.map((ao) => ({
          label: `${ao.name} (${ao.parentOrgName})`,
          value: ao.id.toString(),
        }))
        ?.sort((a, b) => a.label.localeCompare(b.label)) ?? []
    );
  }, [aos, formRegionId]);

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Event Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Workout Name
          </div>
          <Input {...form.register("eventName")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.eventName?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Day of Week
          </div>
          <ControlledSelect
            control={form.control}
            name="eventDayOfWeek"
            options={DayOfWeek.map((day) => ({
              value: day,
              label: convertCase({
                str: day,
                fromCase: Case.LowerCase,
                toCase: Case.TitleCase,
              }),
            }))}
            placeholder="Select a day of the week"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.eventDayOfWeek?.message}
          </p>
        </div>

        <div className="space-y-2">
          <ControlledTimeInput
            control={form.control}
            name="eventStartTime"
            id={"eventStartTime"}
            label={"Start Time"}
          />
        </div>
        <div className="space-y-2">
          <ControlledTimeInput
            control={form.control}
            name="eventEndTime"
            id={"eventEndTime"}
            label={"End Time"}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Types
          </div>
          <Controller
            control={form.control}
            name="eventTypeIds"
            render={({ field, fieldState }) => {
              console.log("eventTypes", eventTypes, field.value);
              return (
                <div>
                  <MultiSelect
                    hideSelectAll
                    defaultValue={(field.value ?? []).map(String)}
                    value={(field.value ?? []).map(String)}
                    options={
                      eventTypes?.eventTypes.map((type) => ({
                        label: type.name,
                        value: type.id.toString(),
                      })) ?? []
                    }
                    onValueChange={(values) =>
                      field.onChange(values.map(Number))
                    }
                    placeholder="Select event types"
                  />
                  {fieldState.error && (
                    <p className="text-xs text-destructive">
                      You must select at least one event type
                    </p>
                  )}
                </div>
              );
            }}
          />
        </div>

        <div className="mx-2 space-y-2 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Description
          </div>
          <Textarea
            {...form.register("eventDescription")}
            placeholder="Tell people if there's anything they need to know prior to showing up to the workout"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.eventDescription?.message}
          </p>
        </div>
      </div>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Physical Location Details:
      </h2>
      <div className="text-sm font-medium text-muted-foreground">
        Location Region
      </div>
      <div className="mb-3">
        <VirtualizedCombobox
          key={formRegionId?.toString()}
          options={
            regions
              ?.map((region) => ({
                label: region.name,
                value: region.id.toString(),
              }))
              .sort((a, b) => a.label.localeCompare(b.label)) ?? []
          }
          value={formRegionId?.toString()}
          onSelect={(item) => {
            const region = regions?.find(
              (region) => region.id.toString() === item,
            );
            if (region) {
              form.setValue("regionId", region.id);
            }
          }}
          searchPlaceholder="Select"
        />
        <p className="text-xs text-destructive">
          {form.formState.errors.regionId?.message}
        </p>
      </div>
      <div className="text-sm font-medium text-muted-foreground">
        Existing location
      </div>
      <div className="mb-3">
        <VirtualizedCombobox
          key={formLocationId?.toString()}
          className="w-full"
          options={sortedRegionLocationOptions ?? []}
          value={formLocationId?.toString()}
          onSelect={(item) => {
            const location = locations?.locations.find(
              ({ id }) => id.toString() === item,
            );
            form.setValue("locationId", location?.id ?? null);
            if (!location) return;

            // Handle different property names between components
            form.setValue("locationDescription", location.description ?? "");
            form.setValue("locationAddress", location.addressStreet);
            form.setValue("locationAddress2", location.addressStreet2);
            form.setValue("locationCity", location.addressCity);
            form.setValue("locationState", location.addressState);
            form.setValue("locationZip", location.addressZip);
            form.setValue("locationCountry", location.addressCountry);

            // We need to keep the lat lng when the marker has been moved
            if (!isAdminForm) {
              const possiblyUpdatedLocation = mapStore.get(
                "modifiedLocationMarkers",
              )[location.id];
              form.setValue(
                "locationLat",
                possiblyUpdatedLocation?.lat ?? location.latitude,
              );
              form.setValue(
                "locationLng",
                possiblyUpdatedLocation?.lng ?? location.longitude,
              );
            } else {
              form.setValue("locationLat", location.latitude);
              form.setValue("locationLng", location.longitude);
            }

            if (location?.regionId == undefined) {
              // @ts-expect-error -- must remove regionId from form
              form.setValue("regionId", null);
            } else {
              form.setValue("regionId", location?.regionId);
            }
          }}
          searchPlaceholder="Select"
        />
        <div className="mx-3 text-xs text-muted-foreground">
          Select a location above to move this workout to a different location
        </div>
      </div>
      <div className="my-2 text-base font-bold text-foreground">
        The fields below update the location for all associated workouts
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Description
          </div>
          <Textarea
            {...form.register("locationDescription")}
            placeholder="Help people unfamiliar with the area find you"
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationDescription?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Address
          </div>
          <Input {...form.register("locationAddress")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Address 2
          </div>
          <Input {...form.register("locationAddress2")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress2?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location City
          </div>
          <Input {...form.register("locationCity")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCity?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location State
          </div>
          <Input {...form.register("locationState")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationState?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Zip
          </div>
          <Input {...form.register("locationZip")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationZip?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Country
          </div>
          <CountrySelect control={form.control} name="locationCountry" />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCountry?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Latitude
          </div>
          <Input {...form.register("locationLat", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLat?.message?.toString?.()}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Longitude
          </div>
          <Input {...form.register("locationLng", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLng?.message?.toString?.()}
          </p>
        </div>
      </div>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        AO Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Existing AO
          </div>
          <div className="mb-3">
            <VirtualizedCombobox
              key={formAoId?.toString()}
              options={sortedRegionAoOptions}
              value={formAoId?.toString()}
              onSelect={(item) => {
                const ao = aos?.find((ao) => ao.id.toString() === item);
                if (ao) {
                  form.setValue("aoId", ao.id);
                  form.setValue("aoName", ao.name);
                  form.setValue("aoLogo", ao.logoUrl);
                }
              }}
              searchPlaceholder="Select"
              className="overflow-hidden"
            />
            <div className="mx-1 mt-1 text-xs text-muted-foreground">
              Select an AO here to move this workout to a different AO
            </div>
          </div>
          <p className="text-xs text-destructive">
            {form.formState.errors.aoId?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Name
          </div>
          <Input {...form.register("aoName")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoName?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Logo
          </div>
          <Controller
            control={form.control}
            name="aoLogo"
            render={({ field: { onChange, value } }) => {
              return (
                <div className="grid grid-cols-[1fr_64px] items-center">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      if (formRegionId == null) {
                        toast.error("Please select a region first");
                        return;
                      }
                      console.log("files", e.target.files);
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const blob640 = await scaleAndCropImage(file, 640, 640);
                      if (!blob640) return;
                      const url640 = await uploadLogo({
                        file: blob640,
                        regionId: formRegionId,
                        requestId: formId,
                      });
                      onChange(url640);
                      const blob64 = await scaleAndCropImage(file, 64, 64);
                      if (blob64) {
                        await uploadLogo({
                          file: blob64,
                          regionId: formRegionId,
                          requestId: formId,
                          size: 64,
                        });
                      }
                    }}
                    disabled={lt(formRegionId, 0)}
                    className="flex-1"
                  />
                  {value && (
                    <button
                      type="button"
                      className="relative size-16 cursor-pointer"
                      onClick={() => onChange("")}
                    >
                      <DebouncedImage
                        src={value}
                        alt="AO Logo"
                        onImageFail={() => form.setValue("badImage", true)}
                        onImageSuccess={() => form.setValue("badImage", false)}
                      />
                      <div className="absolute -top-1 right-[-1px] flex size-5 items-center justify-center rounded-full bg-red-500 text-white">
                        <X className="size-3" />
                      </div>
                    </button>
                  )}
                </div>
              );
            }}
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoLogo?.message}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Website
          </div>
          <Input {...form.register("aoWebsite")} />
          <div className="text-xs text-muted-foreground">
            Only add an <span className="font-semibold">AO</span> website here
            if it is different than the{" "}
            <span className="font-semibold">Region</span> website (edited
            separately). Both show on the map event.
          </div>
          <p className="text-xs text-destructive">
            {form.formState.errors.aoWebsite?.message}
          </p>
        </div>
      </div>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Other Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Submitter Email
          </div>
          <Input {...form.register("submittedBy")} disabled={isAdminForm} />
          <p className="text-xs text-destructive">
            {form.formState.errors.submittedBy?.message}
          </p>
        </div>
      </div>
    </>
  );
};

export const DevLoadTestData = () => {
  const form = useUpdateLocationFormContext();
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
        !values.eventStartTime && form.setValue("eventStartTime", "0900");
        !values.eventEndTime && form.setValue("eventEndTime", "1000");
        !values.eventDescription &&
          form.setValue("eventDescription", "Test Description");
      }}
    >
      (DEV) Load Test Data
    </Button>
  );
};

export const FormDebugData = () => {
  const form = useUpdateLocationFormContext();
  const formId = form.watch("id");
  const formEventId = form.watch("eventId");
  const formAoId = form.watch("aoId");
  const formRegionId = form.watch("regionId");
  const formLocationId = form.watch("locationId");
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">formId: {formId};</p>
      <p className="text-sm text-muted-foreground">regionId: {formRegionId};</p>
      <p className="text-sm text-muted-foreground">aoId: {formAoId};</p>
      <p className="text-sm text-muted-foreground">
        locationId: {formLocationId};
      </p>
      <p className="text-sm text-muted-foreground">eventId: {formEventId}</p>
    </div>
  );
};
