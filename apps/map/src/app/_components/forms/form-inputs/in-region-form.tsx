import { Controller, useFormContext } from "react-hook-form";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { orpc, useQuery } from "~/orpc/react";
import { useOptions } from "~/utils/use-options";

interface InRegionFormValues {
  originalRegionId?: number | null;
}

// TODO: Fix selection form for all use cases
export const InRegionForm = <_T extends InRegionFormValues>() => {
  const form = useFormContext<InRegionFormValues>();

  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );

  const regionOptions = useOptions(
    regions?.orgs,
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
                    const region = regions?.orgs.find(
                      (region) => region.id.toString() === item,
                    );
                    field.onChange(region?.id ?? null);
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
