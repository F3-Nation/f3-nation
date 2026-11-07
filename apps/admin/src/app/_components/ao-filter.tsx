import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

type AO = RouterOutputs["org"]["all"]["orgs"][number];

const labelKey = (label: string) => label.toLowerCase();

/**
 * Labels each AO so that distinct AOs never share a label: the parent org is
 * added when the choices span more than one parent, and the ID (the only
 * field that is always unique) when the label would still repeat. The
 * combobox searches and shows the selected value from the label, so this
 * context is searchable and stays visible after selection.
 */
function buildAoOptions(aos: AO[]) {
  const spansParents = new Set(aos.map((ao) => ao.parentId)).size > 1;
  const labelled = aos.map((ao) => {
    const parts = [ao.name.trim()];
    const parentName = ao.parentOrgName?.trim();
    if (spansParents && parentName) parts.push(parentName);
    return { ao, base: parts.join(" · ") };
  });
  const labelCounts = new Map<string, number>();
  for (const { base } of labelled) {
    const key = labelKey(base);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  return labelled
    .map(({ ao, base }) => {
      const repeats = (labelCounts.get(labelKey(base)) ?? 0) > 1;
      return {
        label: repeats ? `${base} · ID ${ao.id}` : base,
        value: ao.id.toString(),
      };
    })
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
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
