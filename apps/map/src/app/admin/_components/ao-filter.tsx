import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import { orpc, useQuery } from "~/orpc/react";

type AO = RouterOutputs["org"]["all"]["orgs"][number];

export const AOSFilter = ({
  onAoSelect,
  selectedAos,
}: {
  onAoSelect: (ao: AO) => void;
  selectedAos: AO[];
}) => {
  const { data: aos } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );

  return (
    <div className="max-w-80">
      <VirtualizedCombobox
        popoverContentAlign="end"
        options={
          aos?.orgs
            ?.map((ao) => ({
              label: ao.name,
              value: ao.id.toString(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)) ?? []
        }
        value={selectedAos.map((ao) => ao.id.toString())}
        onSelect={(item) => {
          const ao = aos?.orgs.find((ao) => ao.id.toString() === item);
          if (ao) {
            onAoSelect(ao);
          }
        }}
        searchPlaceholder="AO"
      />
    </div>
  );
};
