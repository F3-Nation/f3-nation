import { Controller, useFormContext } from "react-hook-form";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

import { client } from "~/orpc/client";
import { useOptions } from "~/utils/use-options";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

interface InRegionFormValues {
  originalRegionId?: number | null;
}

// TODO: Fix selection form for all use cases
export const InRegionForm = () => {
  const form = useFormContext<InRegionFormValues>();

  const { data: regions } = useFetchAllPages({
    queryKey: ["org.all.everyRegion"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: ["region"],
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });

  const regionOptions = useOptions(
    regions,
    (r) => r.name,
    (r) => r.id.toString(),
  );

  return (
    <>
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        In Region:
      </h2>
      <div className="flex flex-row flex-wrap gap-4">
        <div className="flex-1 space-y-2">
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
                    // Never write null — the request schemas require a
                    // positive number, so an unresolved selection stays
                    // undefined and surfaces the schema's required error.
                    field.onChange(region?.id);
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
