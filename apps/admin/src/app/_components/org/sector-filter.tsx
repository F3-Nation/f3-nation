import type { RouterOutputs } from "~/orpc/types";
import { OrgPickerFilter } from "./org-picker-filter";

type Sector = RouterOutputs["org"]["all"]["orgs"][number];

export const SectorFilter = ({
  onSectorSelect,
  selectedSectors,
  sectors,
}: {
  onSectorSelect: (sector: Sector) => void;
  selectedSectors: Sector[];
  sectors: Sector[] | undefined;
}) => (
  <OrgPickerFilter
    orgType="sector"
    orgs={sectors}
    selected={selectedSectors}
    onSelect={onSectorSelect}
  />
);
