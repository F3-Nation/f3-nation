import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import { orpc, useQuery } from "~/orpc/react";

type Region = RouterOutputs["org"]["all"]["orgs"][number];

export const RegionFilter = ({
  onRegionSelect,
  selectedRegions,
}: {
  onRegionSelect: (region: Region) => void;
  selectedRegions: Region[];
}) => {
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );

  return (
    <div className="max-w-80">
      <VirtualizedCombobox
        popoverContentAlign="end"
        options={
          regions?.orgs
            ?.map((region) => ({
              label: region.name,
              value: region.id.toString(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)) ?? []
        }
        value={selectedRegions.map((region) => region.id.toString())}
        onSelect={(item) => {
          const region = regions?.orgs.find(
            (region) => region.id.toString() === item,
          );
          if (region) {
            onRegionSelect(region);
          }
        }}
        searchPlaceholder="Region"
      />
    </div>
  );
};
