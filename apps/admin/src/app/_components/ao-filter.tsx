import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

type AO = RouterOutputs["org"]["all"]["orgs"][number];

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Labels each AO so that distinct AOs never share a label. The parent org
 * (usually the region) is added when the choices span more than one parent,
 * and AOs whose name repeats within one parent also get their ID, since
 * `org.all` returns no location or schedule to tell them apart. The combobox
 * searches and shows the selected value from the label, so this context is
 * searchable and stays visible after selection.
 */
function buildAoOptions(aos: AO[]) {
  const spansParents = new Set(aos.map((ao) => ao.parentId)).size > 1;
  const siblingKey = (ao: AO) => `${ao.parentId}:${nameKey(ao.name)}`;
  const siblingNameCounts = new Map<string, number>();
  for (const ao of aos) {
    const key = siblingKey(ao);
    siblingNameCounts.set(key, (siblingNameCounts.get(key) ?? 0) + 1);
  }

  return aos
    .map((ao) => {
      const parts = [ao.name];
      if (spansParents && ao.parentOrgName) parts.push(ao.parentOrgName);
      if ((siblingNameCounts.get(siblingKey(ao)) ?? 0) > 1) {
        parts.push(`ID ${ao.id}`);
      }
      return { label: parts.join(" · "), value: ao.id.toString() };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const AOSFilter = ({
  onAoSelect,
  selectedAos,
}: {
  onAoSelect: (ao: AO) => void;
  selectedAos: AO[];
}) => {
  const { data: aos } = useFetchAllPages({
    path: ["org", "all"],
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
        options={aos ? buildAoOptions(aos) : []}
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
