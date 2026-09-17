import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

type AO = RouterOutputs["org"]["all"]["orgs"][number];

export const AOSFilter = ({
  onAoSelect,
  selectedAos,
}: {
  onAoSelect: (ao: AO) => void;
  selectedAos: AO[];
}) => {
  const { data: aos } = useFetchAllPages({
    queryKey: ["org.all.everyAo"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: ["ao"],
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });

  return (
    <div className="max-w-80">
      <VirtualizedCombobox
        popoverContentAlign="end"
        options={
          aos
            ?.map((ao) => ({
              label: ao.name,
              value: ao.id.toString(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)) ?? []
        }
        value={selectedAos.map((ao) => ao.id.toString())}
        onSelect={(item) => {
          const ao = aos?.find((ao) => ao.id.toString() === item);
          if (ao) {
            onAoSelect(ao);
          }
        }}
        searchPlaceholder="AO"
      />
    </div>
  );
};
