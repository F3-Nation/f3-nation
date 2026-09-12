import { useMemo, useReducer, useState } from "react";
import { IsActiveStatus } from "@acme/shared/app/enums";
import { orpc, useQuery } from "~/orpc/react";
import type { RouterOutputs } from "~/orpc/types";
import type { OrgAdminConfig } from "./org-admin-config";
import {
  getOrgById,
  getParentOrgIdsForFilter,
  isDescendantOfAny,
  isOrgSelected,
} from "./org-ancestry";

type Org = RouterOutputs["org"]["all"]["orgs"][number];
interface OrgFilterState {
  selectedAreas: Org[];
  selectedSectors: Org[];
}
type OrgFilterAction =
  | { type: "toggle-sector"; sector: Org; orgById: ReadonlyMap<number, Org> }
  | { type: "toggle-area"; area: Org }
  | { type: "reset" };
const initialOrgFilterState: OrgFilterState = {
  selectedAreas: [],
  selectedSectors: [],
};

// Preserve the Region reducer's atomic selection/pruning behavior from #920.
const orgFilterReducer = (
  state: OrgFilterState,
  action: OrgFilterAction,
): OrgFilterState => {
  if (action.type === "reset") return initialOrgFilterState;
  if (action.type === "toggle-area") {
    const isSelected = isOrgSelected(state.selectedAreas, action.area);
    return {
      ...state,
      selectedAreas: isSelected
        ? state.selectedAreas.filter((area) => area.id !== action.area.id)
        : [...state.selectedAreas, action.area],
    };
  }
  const isSelected = isOrgSelected(state.selectedSectors, action.sector);
  const selectedSectors = isSelected
    ? state.selectedSectors.filter((sector) => sector.id !== action.sector.id)
    : [...state.selectedSectors, action.sector];
  const selectedSectorIds = new Set(selectedSectors.map((sector) => sector.id));
  return {
    selectedSectors,
    selectedAreas:
      selectedSectorIds.size === 0
        ? state.selectedAreas
        : state.selectedAreas.filter((area) => {
            const currentArea = action.orgById.get(area.id);
            return (
              currentArea !== undefined &&
              isDescendantOfAny(currentArea, selectedSectorIds, action.orgById)
            );
          }),
  };
};

export function useOrgFilters(config: OrgAdminConfig, resetPage: () => void) {
  const [{ selectedAreas, selectedSectors }, dispatch] = useReducer(
    orgFilterReducer,
    initialOrgFilterState,
  );
  const [selectedRegions, setSelectedRegions] = useState<Org[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);
  const { data: hierarchyData } = useQuery(
    orpc.org.all.queryOptions({
      input: { orgTypes: config.ancestorTypes ?? [], statuses: IsActiveStatus },
      enabled: !!config.ancestorTypes,
    }),
  );
  const hierarchyOrgs = hierarchyData?.orgs;
  const orgById = useMemo(
    () => getOrgById(hierarchyOrgs ?? []),
    [hierarchyOrgs],
  );
  const sectors = useMemo(
    () =>
      hierarchyOrgs?.filter((org) => org.orgType === "sector" && org.isActive),
    [hierarchyOrgs],
  );
  const areas = useMemo(
    () =>
      hierarchyOrgs?.filter((org) => org.orgType === "area" && org.isActive),
    [hierarchyOrgs],
  );
  const selectedSectorIds = useMemo(
    () => new Set(selectedSectors.map((sector) => sector.id)),
    [selectedSectors],
  );
  const availableAreas = useMemo(
    () =>
      selectedSectorIds.size === 0
        ? areas
        : areas?.filter((area) =>
            isDescendantOfAny(area, selectedSectorIds, orgById),
          ),
    [areas, orgById, selectedSectorIds],
  );
  const parentOrgIds = useMemo(() => {
    if (config.filters === "region")
      return selectedRegions.map((region) => region.id);
    if (config.filters === "sectorArea")
      return getParentOrgIdsForFilter(
        selectedAreas.map((area) => area.id),
        selectedSectors.length > 0,
        availableAreas?.map((area) => area.id),
      );
    if (config.filters === "sector") {
      const matchingParentIds = hierarchyOrgs
        ?.filter(
          (org) =>
            selectedSectorIds.has(org.id) ||
            isDescendantOfAny(org, selectedSectorIds, orgById),
        )
        .map((org) => org.id);
      return getParentOrgIdsForFilter(
        [],
        selectedSectors.length > 0,
        matchingParentIds,
      );
    }
    return undefined;
  }, [
    config.filters,
    selectedRegions,
    selectedAreas,
    selectedSectors,
    availableAreas,
    hierarchyOrgs,
    selectedSectorIds,
    orgById,
  ]);
  return {
    orgById,
    sectors,
    availableAreas,
    selectedAreas,
    selectedSectors,
    selectedRegions,
    selectedStatuses,
    setSelectedStatuses,
    onlyMine,
    setOnlyMine,
    parentOrgIds,
    activeFilterCount:
      selectedStatuses.length +
      selectedSectors.length +
      selectedAreas.length +
      selectedRegions.length +
      (onlyMine ? 1 : 0),
    handleSectorSelect: (sector: Org) => {
      dispatch({ type: "toggle-sector", sector, orgById });
      resetPage();
    },
    handleAreaSelect: (area: Org) => {
      dispatch({ type: "toggle-area", area });
      resetPage();
    },
    handleRegionSelect: (region: Org) => {
      setSelectedRegions((current) =>
        isOrgSelected(current, region)
          ? current.filter((item) => item.id !== region.id)
          : [...current, region],
      );
      resetPage();
    },
    reset: () => {
      dispatch({ type: "reset" });
      setSelectedRegions([]);
      setSelectedStatuses(["active"]);
      setOnlyMine(true);
      resetPage();
    },
  };
}
