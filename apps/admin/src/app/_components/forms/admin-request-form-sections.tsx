import { X } from "lucide-react";
import { Controller } from "react-hook-form";

import { EVENT_CATEGORY_LABEL_MAP } from "@acme/shared/app/constants";
import { DayOfWeek } from "@acme/shared/app/enums";
import { isProd } from "@acme/shared/common/constants";
import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";
import { Input } from "@acme/ui/input";
import { MultiSelect } from "@acme/ui/multi-select";
import { ControlledSelect } from "@acme/ui/select";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import type { AdminRequestFormProps } from "./admin-request-form-props";
import { DebouncedImage } from "../debounced-image";
import { CountrySelect } from "../modal/country-select";
import { ControlledTimeInput } from "../time-input";

export const formatMetaId = (value: unknown) =>
  typeof value === "number" || typeof value === "string" ? String(value) : "-";

export const EventDetailsFields = () => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");

  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        orgIds: formRegionId ? [formRegionId] : [],
      },
    }),
  );

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
            id="eventStartTime"
            label="Start Time"
          />
        </div>
        <div className="space-y-2">
          <ControlledTimeInput
            control={form.control}
            name="eventEndTime"
            id="eventEndTime"
            label="End Time"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Types
          </div>
          <Controller
            control={form.control}
            name="eventTypeIds"
            render={({ field, fieldState }) => (
              <div>
                <MultiSelect
                  hideSelectAll
                  defaultValue={(field.value ?? []).map(String)}
                  value={(field.value ?? []).map(String)}
                  options={
                    eventTypes?.eventTypes.map((type) => ({
                      label: type.eventCategory
                        ? `${type.name} (${EVENT_CATEGORY_LABEL_MAP[type.eventCategory] ?? type.eventCategory})`
                        : type.name,
                      value: type.id.toString(),
                    })) ?? []
                  }
                  onValueChange={(values) => field.onChange(values.map(Number))}
                  placeholder="Select event types"
                />
                {fieldState.error && (
                  <p className="text-xs text-destructive">
                    You must select at least one event type
                  </p>
                )}
              </div>
            )}
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
    </>
  );
};

export const AoDetailsFields = ({
  selectedAoLogoPreviewUrl,
  onAoLogoFileChange,
}: AdminRequestFormProps) => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        AO Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            AO Website
          </div>
          <Input {...form.register("aoWebsite")} placeholder="https://" />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoWebsite?.message}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            AO Logo
          </div>
          <Controller
            control={form.control}
            name="aoLogo"
            render={({ field: { onChange, value } }) => (
              <div className="grid grid-cols-[1fr_64px] items-center gap-3">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    if (formRegionId == null || formRegionId <= -1) {
                      toast.error("Please select a region first");
                      return;
                    }

                    const file = e.target.files?.[0];
                    if (!file) return;

                    onAoLogoFileChange?.(file, URL.createObjectURL(file));
                  }}
                  disabled={formRegionId == null || formRegionId <= -1}
                  className="flex-1"
                />
                {(selectedAoLogoPreviewUrl ?? value) && (
                  <button
                    type="button"
                    className="relative size-16 cursor-pointer"
                    onClick={() => {
                      if (selectedAoLogoPreviewUrl) {
                        onAoLogoFileChange?.(null, null);
                        return;
                      }

                      onChange("");
                    }}
                  >
                    <DebouncedImage
                      src={selectedAoLogoPreviewUrl ?? value ?? ""}
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
            )}
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.aoLogo?.message}
          </p>
        </div>
      </div>
    </>
  );
};

export const RegionSelectField = ({
  label = "Region",
  searchPlaceholder = "Select a region",
}: {
  label?: string;
  searchPlaceholder?: string;
}) => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const { data: regionsResponse } = useQuery(
    orpc.map.location.regions.queryOptions(),
  );
  const regions = regionsResponse?.regions;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
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
          form.setValue("regionId", region?.id ?? -1);
        }}
        searchPlaceholder={searchPlaceholder}
      />
      <p className="text-xs text-destructive">
        {form.formState.errors.regionId?.message}
      </p>
    </div>
  );
};

export const LocationDetailsFields = ({
  includeRegion = false,
}: {
  includeRegion?: boolean;
}) => {
  const form = useUpdateLocationFormContext();

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Physical Location Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {includeRegion && (
          <div className="space-y-2 sm:col-span-2">
            <RegionSelectField />
          </div>
        )}

        <div className="space-y-2 sm:col-span-2">
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
            Street Address
          </div>
          <Input {...form.register("locationAddress")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Address Line 2
          </div>
          <Input {...form.register("locationAddress2")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress2?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">City</div>
          <Input {...form.register("locationCity")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCity?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            State/Province
          </div>
          <Input {...form.register("locationState")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationState?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            ZIP / Postal Code
          </div>
          <Input {...form.register("locationZip")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationZip?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Country
          </div>
          <CountrySelect control={form.control} name="locationCountry" />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCountry?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Latitude
          </div>
          <Input {...form.register("locationLat", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLat?.message?.toString?.()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Longitude
          </div>
          <Input {...form.register("locationLng", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLng?.message?.toString?.()}
          </p>
        </div>
      </div>
    </>
  );
};

export const SubmitterEmailField = () => {
  const form = useUpdateLocationFormContext();

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Other Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Submitter Email
          </div>
          <Input {...form.register("submittedBy")} disabled />
          <p className="text-xs text-destructive">
            {form.formState.errors.submittedBy?.message}
          </p>
        </div>
      </div>
    </>
  );
};

export const DevMetaSummary = ({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: unknown }[];
}) => {
  if (isProd) return null;

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <div className="space-y-1" key={item.label}>
            <div className="text-sm font-medium text-muted-foreground">
              {item.label}
            </div>
            <div className="text-sm">{formatMetaId(item.value)}</div>
          </div>
        ))}
      </div>
    </>
  );
};
