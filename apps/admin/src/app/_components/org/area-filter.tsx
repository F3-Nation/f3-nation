import type { RouterOutputs } from "~/orpc/types";
import { OrgPickerFilter } from "./org-picker-filter";

type Area = RouterOutputs["org"]["all"]["orgs"][number];

export const AreaFilter = ({
  onAreaSelect,
  selectedAreas,
  areas,
}: {
  onAreaSelect: (area: Area) => void;
  selectedAreas: Area[];
  areas: Area[] | undefined;
}) => (
  <OrgPickerFilter
    orgType="area"
    orgs={areas}
    selected={selectedAreas}
    onSelect={onAreaSelect}
  />
);
