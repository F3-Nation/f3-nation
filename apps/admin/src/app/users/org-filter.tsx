import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import type { OrgType } from "@acme/shared/app/enums";

type Org = RouterOutputs["org"]["all"]["orgs"][number];

export const OrgFilter = ({
  onOrgSelect,
  selectedOrgs,
  label = "Org",
  orgTypes = ["region", "area", "sector"],
}: {
  onOrgSelect: (org: Org) => void;
  selectedOrgs: Org[];
  label?: string;
  orgTypes?: OrgType[];
}) => {
  const { data: orgs } = useFetchAllPages({
    queryKey: ["org.all.everyOrgType", orgTypes],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes,
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
          orgs
            ?.map((org) => ({
              label: `(${org.orgType.toUpperCase()}) ${org.name}`,
              value: org.id.toString(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)) ?? []
        }
        value={selectedOrgs.map((org) => org.id.toString())}
        onSelect={(item) => {
          const org = orgs?.find((org) => org.id.toString() === item);
          if (org) {
            onOrgSelect(org);
          }
        }}
        searchPlaceholder={label}
      />
    </div>
  );
};
