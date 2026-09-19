import type { RouterOutputs } from "~/orpc/types";
import { OrgPickerFilter } from "./org-picker-filter";

type Territory = RouterOutputs["org"]["all"]["orgs"][number];

export const TerritoryFilter = ({
  onTerritorySelect,
  selectedTerritories,
  territories,
}: {
  onTerritorySelect: (territory: Territory) => void;
  selectedTerritories: Territory[];
  territories: Territory[] | undefined;
}) => (
  <OrgPickerFilter
    orgType="territory"
    orgs={territories}
    selected={selectedTerritories}
    onSelect={onTerritorySelect}
  />
);
