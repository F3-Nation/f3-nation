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
  selectedTerritories: Org[];
  selectedSectors: Org[];
}
type OrgFilterAction =
  | { type: "toggle-sector"; sector: Org; orgById: ReadonlyMap<number, Org> }
  | { type: "toggle-territory"; territory: Org }
  | { type: "toggle-area"; area: Org }
  | { type: "reconcile"; selected: OrgFilterState }
  | { type: "reset" };
const initialOrgFilterState: OrgFilterState = {
  selectedAreas: [],
  selectedTerritories: [],
  selectedSectors: [],
};

// Keep only selections still beneath a selected sector, judged by their current
// ancestry so a reparenting refetch is honored.
const pruneToSectors = (
  selected: Org[],
  sectorIds: ReadonlySet<number>,
  orgById: ReadonlyMap<number, Org>,
) =>
  sectorIds.size === 0
    ? selected
    : selected.filter((org) => {
        const current = orgById.get(org.id);
        return (
          current !== undefined &&
          isDescendantOfAny(current, sectorIds, orgById)
        );
      });

// A selection counts only while its picker still offers it, so a refetch that
// reparents or deactivates an org cannot leave a hidden, undeselectable filter.
// Until the hierarchy loads there is nothing to judge against.
const keepOffered = (selected: Org[], offered: Org[] | undefined) => {
  if (!offered) return selected;
  const offeredIds = new Set(offered.map((org) => org.id));
  return selected.filter((org) => offeredIds.has(org.id));
};

// Preserve the Region reducer's atomic selection/pruning behavior from #920.
const orgFilterReducer = (
  state: OrgFilterState,
  action: OrgFilterAction,
): OrgFilterState => {
  if (action.type === "reset") return initialOrgFilterState;
  if (action.type === "reconcile") return action.selected;
  if (action.type === "toggle-area") {
    const isSelected = isOrgSelected(state.selectedAreas, action.area);
    return {
      ...state,
      selectedAreas: isSelected
        ? state.selectedAreas.filter((area) => area.id !== action.area.id)
        : [...state.selectedAreas, action.area],
    };
  }
  if (action.type === "toggle-territory") {
    const isSelected = isOrgSelected(
      state.selectedTerritories,
      action.territory,
    );
    return {
      ...state,
      selectedTerritories: isSelected
        ? state.selectedTerritories.filter(
            (territory) => territory.id !== action.territory.id,
          )
        : [...state.selectedTerritories, action.territory],
    };
  }
  const isSelected = isOrgSelected(state.selectedSectors, action.sector);
  const selectedSectors = isSelected
    ? state.selectedSectors.filter((sector) => sector.id !== action.sector.id)
    : [...state.selectedSectors, action.sector];
  const selectedSectorIds = new Set(selectedSectors.map((sector) => sector.id));
  return {
    selectedSectors,
    selectedAreas: pruneToSectors(
      state.selectedAreas,
      selectedSectorIds,
      action.orgById,
    ),
    selectedTerritories: pruneToSectors(
      state.selectedTerritories,
      selectedSectorIds,
      action.orgById,
    ),
  };
};

export function useOrgFilters(config: OrgAdminConfig, resetPage: () => void) {
  const [pickedFilters, dispatch] = useReducer(
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
      input: {
        orgTypes: [
          ...(config.ancestorTypes ?? []),
          ...(config.intermediateTypes ?? []),
        ],
        statuses: IsActiveStatus,
      },
      enabled: !!config.ancestorTypes,
    }),
  );
  // Keep filter candidates unchanged while retaining intermediate nodes in the
  // lookup used to traverse persisted same-tier ancestry.
  const hierarchyOrgs = useMemo(
    () =>
      hierarchyData?.orgs.filter((org) =>
        config.ancestorTypes?.includes(org.orgType),
      ),
    [hierarchyData, config.ancestorTypes],
  );
  const orgById = useMemo(
    () => getOrgById(hierarchyData?.orgs ?? []),
    [hierarchyData],
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
  const territories = useMemo(
    () =>
      hierarchyOrgs?.filter(
        (org) => org.orgType === "territory" && org.isActive,
      ),
    [hierarchyOrgs],
  );
  const selectedSectors = useMemo(
    () => keepOffered(pickedFilters.selectedSectors, sectors),
    [pickedFilters.selectedSectors, sectors],
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
  const availableTerritories = useMemo(
    () =>
      selectedSectorIds.size === 0
        ? territories
        : territories?.filter((territory) =>
            isDescendantOfAny(territory, selectedSectorIds, orgById),
          ),
    [territories, orgById, selectedSectorIds],
  );
  const selectedAreas = useMemo(
    () => keepOffered(pickedFilters.selectedAreas, availableAreas),
    [pickedFilters.selectedAreas, availableAreas],
  );
  const selectedTerritories = useMemo(
    () => keepOffered(pickedFilters.selectedTerritories, availableTerritories),
    [pickedFilters.selectedTerritories, availableTerritories],
  );
  // Store the drops too, so a dropped selection cannot return when the sector
  // selection later changes. Each pass strictly shrinks the stored picks.
  if (
    selectedSectors.length !== pickedFilters.selectedSectors.length ||
    selectedAreas.length !== pickedFilters.selectedAreas.length ||
    selectedTerritories.length !== pickedFilters.selectedTerritories.length
  ) {
    dispatch({
      type: "reconcile",
      selected: { selectedSectors, selectedAreas, selectedTerritories },
    });
  }
  // A selected sector, and everything the loaded hierarchy places beneath it.
  const sectorAndDescendantIds = useMemo(
    () =>
      hierarchyOrgs
        ?.filter(
          (org) =>
            selectedSectorIds.has(org.id) ||
            isDescendantOfAny(org, selectedSectorIds, orgById),
        )
        .map((org) => org.id),
    [hierarchyOrgs, selectedSectorIds, orgById],
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
    if (config.filters === "sector")
      return getParentOrgIdsForFilter(
        [],
        selectedSectors.length > 0,
        sectorAndDescendantIds,
      );
    if (config.filters === "sectorTerritory")
      return getParentOrgIdsForFilter(
        selectedTerritories.map((territory) => territory.id),
        selectedSectors.length > 0,
        sectorAndDescendantIds,
      );
    return undefined;
  }, [
    config.filters,
    selectedRegions,
    selectedAreas,
    selectedTerritories,
    selectedSectors,
    availableAreas,
    sectorAndDescendantIds,
  ]);
  return {
    orgById,
    sectors,
    availableAreas,
    availableTerritories,
    selectedAreas,
    selectedTerritories,
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
      selectedTerritories.length +
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
    handleTerritorySelect: (territory: Org) => {
      dispatch({ type: "toggle-territory", territory });
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
