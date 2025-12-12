import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import { orpc, useQuery } from "~/orpc/react";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const OrgFilter = ({
  onOrgSelect,
  selectedOrgs,
}: {
  onOrgSelect: (org: Org) => void;
  selectedOrgs: Org[];
}) => {
  const { data: orgs } = useQuery(
    orpc.org.all.queryOptions({
      input: { orgTypes: ["region", "area", "sector"] },
    }),
  );

  return (
    <div className="max-w-80">
      <VirtualizedCombobox
        popoverContentAlign="end"
        options={
          orgs?.orgs
            ?.map((org) => ({
              label: `(${org.orgType.toUpperCase()}) ${org.name}`,
              value: org.id.toString(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)) ?? []
        }
        value={selectedOrgs.map((org) => org.id.toString())}
        onSelect={(item) => {
          const org = orgs?.orgs.find((org) => org.id.toString() === item);
          if (org) {
            onOrgSelect(org);
          }
        }}
        searchPlaceholder="Org"
      />
    </div>
  );
};
