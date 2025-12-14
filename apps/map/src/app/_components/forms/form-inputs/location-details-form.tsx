import { Controller, useFormContext } from "react-hook-form";

import { Input } from "@acme/ui/input";
import { Textarea } from "@acme/ui/textarea";

import { CountrySelect } from "../../modal/country-select";

interface LocationDetailsFormValues {
  locationAddress?: string;
  locationAddress2?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationZip?: string | null;
  locationCountry?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  locationDescription?: string | null;
}

export const LocationDetailsForm = <_T extends LocationDetailsFormValues>() => {
  const form = useFormContext<LocationDetailsFormValues>();

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        Physical Location Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Street Address
          </div>
          <Input {...form.register("locationAddress")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress?.message?.toString()}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Address Line 2
          </div>
          <Input {...form.register("locationAddress2")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationAddress2?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">City</div>
          <Input {...form.register("locationCity")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCity?.message?.toString()}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            State/Province
          </div>
          <Input {...form.register("locationState")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationState?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            ZIP / Postal Code
          </div>
          <Input {...form.register("locationZip")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationZip?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Country
          </div>
          <Controller
            control={form.control}
            name="locationCountry"
            render={() => (
              <CountrySelect
                control={form.control}
                name="locationCountry"
                disabled={false}
                placeholder="Select a country"
              />
            )}
          />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationCountry?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Latitude
          </div>
          <Input {...form.register("locationLat", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLat?.message?.toString()}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Longitude
          </div>
          <Input {...form.register("locationLng", { valueAsNumber: true })} />
          <p className="text-xs text-destructive">
            {form.formState.errors.locationLng?.message?.toString()}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Location Description
          </div>
          <div className="px-1">
            <Textarea
              {...form.register("locationDescription")}
              placeholder="Provide additional details about the meet-up location (e.g. 'Meet at the south entrance', 'The corner of Main and Oak St')"
            />
          </div>
          <p className="text-xs text-destructive">
            {form.formState.errors.locationDescription?.message?.toString()}
          </p>
        </div>
      </div>
    </>
  );
};
