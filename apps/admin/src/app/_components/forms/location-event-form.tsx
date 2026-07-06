import lt from "lodash/lt";
import { X } from "lucide-react";
import { useMemo } from "react";
import { Controller } from "react-hook-form";

import type { RequestType } from "@acme/shared/app/enums";
import { Input } from "@acme/ui/input";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useUpdateLocationFormContext } from "~/utils/forms";
import { DebouncedImage } from "../debounced-image";
import { CountrySelect } from "../modal/country-select";
import {
  EventDetailsFields,
  LocationPickerField,
  RegionSelectField,
} from "./admin-request-form-sections";
import { RequestInsertSchema } from "@acme/validators";
import { z } from "zod";

export const UpdateLocationSchema = RequestInsertSchema.extend({
  badImage: z.boolean().default(false),
});

type UpdateLocationSchema = z.infer<typeof UpdateLocationSchema>;

const REQUEST_TYPES_WITH_EVENT_FIELDS: RequestType[] = [
  "create_ao_and_location_and_event",
  "create_event",
  "edit_event",
  "move_event_to_new_ao",
];

export const LocationEventForm = ({
  isAdminForm = true,
  selectedAoLogoPreviewUrl,
  onAoLogoFileChange,
  requestType,
}: {
  isAdminForm?: boolean;
  selectedAoLogoPreviewUrl?: string | null;
  onAoLogoFileChange?: (file: File | null, previewUrl: string | null) => void;
  requestType?: RequestType;
}) => {
  const form = useUpdateLocationFormContext();
  const formRegionId = form.watch("regionId");
  const formAoId = form.watch("aoId");

  const showEventFields =
    !requestType || REQUEST_TYPES_WITH_EVENT_FIELDS.includes(requestType);

  const { data: allAoData } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );
  const aos = useMemo(() => allAoData?.orgs, [allAoData]);

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
      {showEventFields && <EventDetailsFields />}
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Physical Location Details:
      </h2>
      <div className="mb-3">
        <RegionSelectField label="Location Region" />
      </div>
      <div className="mb-3">
        <LocationPickerField
          helperText={
            showEventFields
              ? "Select a location above to move this workout to a different location"
              : "Select a location above to move this AO to a different location"
          }
        />
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
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
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
                  onAoLogoFileChange?.(null, null);
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
                    onChange={(e) => {
                      if (formRegionId == null) {
                        toast.error("Please select a region first");
                        return;
                      }
                      const file = e.target.files?.[0];
                      if (!file) return;

                      onAoLogoFileChange?.(file, URL.createObjectURL(file));
                    }}
                    disabled={lt(formRegionId, 0)}
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
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
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
