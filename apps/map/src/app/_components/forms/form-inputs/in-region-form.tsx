import { Controller, useFormContext } from "react-hook-form";

import { api } from "~/trpc/react";
import { useOptions } from "~/utils/use-options";
import { VirtualizedCombobox } from "../../virtualized-combobox";

interface InRegionFormValues {
  originalRegionId?: number;
}

// TODO: Fix selection form for all use cases
export const InRegionForm = <_T extends InRegionFormValues>() => {
  const form = useFormContext<InRegionFormValues>();

  const { data: regions } = api.location.getRegions.useQuery();

  const regionOptions = useOptions(
    regions,
    (r) => r.name,
    (r) => r.id.toString(),
  );

  return (
    <>
      <h2 className="mb-2 mt-4 text-xl font-semibold text-muted-foreground">
        In Region:
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium text-muted-foreground">
            Region:
          </div>
          <Controller
            control={form.control}
            name="originalRegionId"
            render={({ field, fieldState }) => (
              <>
                <VirtualizedCombobox
                  key={field.value?.toString()}
                  options={regionOptions}
                  value={field.value?.toString()}
                  onSelect={(item) => {
                    const region = regions?.find(
                      (region) => region.id.toString() === item,
                    );
                    form.setValue(
                      "originalRegionId",
                      // @ts-expect-error - need to unset regionId despite zod
                      region?.id ?? (null as number),
                    );
                  }}
                  searchPlaceholder="Select Region"
                />
                <p className="text-xs text-destructive">
                  {fieldState.error?.message?.toString()}
                </p>
              </>
            )}
          />
        </div>
      </div>
    </>
  );
};
