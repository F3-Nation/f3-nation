import { useMemo, useReducer, useState } from "react";
import type { OrgType } from "@acme/shared/app/enums";
import { IsActiveStatus } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { client } from "~/orpc/client";
import type { RouterOutputs } from "~/orpc/types";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import type { OrgAdminConfig } from "./org-admin-config";
import {
  getHierarchyParentOrgIds,
  getOrgById,
  isDescendantOfAny,
  isOrgSelected,
} from "./org-ancestry";

type Org = RouterOutputs["org"]["all"]["orgs"][number];
type OrgFilterState = Partial<Record<OrgType, Org[]>>;
type OrgFilterAction =
  | {
      type: "toggle";
      orgType: OrgType;
      org: Org;
      prune?: { tiers: OrgType[]; orgById: ReadonlyMap<number, Org> };
    }
  | { type: "reconcile"; selected: OrgFilterState }
  | { type: "reset" };
const initialOrgFilterState: OrgFilterState = {};
const NO_TIERS: OrgType[] = [];
const NO_ORGS: Org[] = [];

const picked = (state: OrgFilterState, orgType: OrgType) =>
  state[orgType] ?? NO_ORGS;

// Keep only selections still beneath a selected ancestor, judged by their
// current ancestry so a reparenting refetch is honored.
const pruneToAncestors = (
  selected: Org[],
  ancestorIds: ReadonlySet<number>,
  orgById: ReadonlyMap<number, Org>,
) =>
  ancestorIds.size === 0
    ? selected
    : selected.filter((org) => {
        const current = orgById.get(org.id);
        return (
          current !== undefined &&
          isDescendantOfAny(current, ancestorIds, orgById)
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

// Toggling a tier and pruning the later ones is one atomic step, so
// back-to-back toggles before a render cannot drop each other (#920).
const orgFilterReducer = (
  state: OrgFilterState,
  action: OrgFilterAction,
): OrgFilterState => {
  if (action.type === "reset") return initialOrgFilterState;
  if (action.type === "reconcile") return { ...state, ...action.selected };

  const current = picked(state, action.orgType);
  const selected = isOrgSelected(current, action.org)
    ? current.filter((org) => org.id !== action.org.id)
    : [...current, action.org];
  const next: OrgFilterState = { ...state, [action.orgType]: selected };
  if (action.prune) {
    const ancestorIds = new Set(selected.map((org) => org.id));
    for (const tier of action.prune.tiers) {
      next[tier] = pruneToAncestors(
        picked(state, tier),
        ancestorIds,
        action.prune.orgById,
      );
    }
  }
  return next;
};

interface OrgFilterControl {
  orgType: OrgType;
  label: string;
  orgs: Org[] | undefined;
  selected: Org[];
  onToggle: (org: Org) => void;
}

export function useOrgFilters(config: OrgAdminConfig, resetPage: () => void) {
  const [pickedFilters, dispatch] = useReducer(
    orgFilterReducer,
    initialOrgFilterState,
  );
  const [selectedStatuses, setSelectedStatuses] = useState<IsActiveStatus[]>([
    "active",
  ]);
  const [onlyMine, setOnlyMine] = useState(true);
  const tiers = config.hierarchyFilter?.tiers ?? NO_TIERS;
  // Paged via useFetchAllPages rather than the old "omit both pageIndex and
  // pageSize" escape hatch — org.all now bounds that branch server-side (see
  // packages/api/src/lib/pagination.ts), so an unpaginated fetch would
  // silently truncate the sector/territory hierarchy for any org with more
  // than a default page's worth of children.
  const { data: hierarchyDataOrgs } = useFetchAllPages({
    path: ["org", "all"],
    queryKey: [
      "org.all.hierarchy",
      config.ancestorTypes,
      config.intermediateTypes,
    ],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: [
          ...(config.ancestorTypes ?? []),
          ...(config.intermediateTypes ?? []),
        ],
        statuses: IsActiveStatus,
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
    enabled: !!config.ancestorTypes,
  });
  // Keep filter candidates unchanged while retaining intermediate nodes in the
  // lookup for irregular legacy/imported or directly written same-tier ancestry.
  // The API parent rule rejects creating these relationships.
  const hierarchyOrgs = useMemo(
    () =>
      hierarchyDataOrgs?.filter((org) =>
        config.ancestorTypes?.includes(org.orgType),
      ),
    [hierarchyDataOrgs, config.ancestorTypes],
  );
  const orgById = useMemo(
    () => getOrgById(hierarchyDataOrgs ?? []),
    [hierarchyDataOrgs],
  );
  const tierStates = useMemo(() => {
    // The nearest earlier tier with a selection narrows each picker.
    let ancestorIds = new Set<number>();
    return tiers.map((orgType) => {
      let offered = hierarchyOrgs?.filter(
        (org) => org.orgType === orgType && org.isActive,
      );
      if (ancestorIds.size > 0) {
        offered = offered?.filter((org) =>
          isDescendantOfAny(org, ancestorIds, orgById),
        );
      }
      const kept = keepOffered(picked(pickedFilters, orgType), offered);
      if (kept.length > 0) ancestorIds = new Set(kept.map((org) => org.id));
      return { orgType, offered, kept };
    });
  }, [tiers, pickedFilters, hierarchyOrgs, orgById]);
  const selected = useMemo(
    () =>
      Object.fromEntries(
        tierStates.map(({ orgType, kept }) => [orgType, kept]),
      ),
    [tierStates],
  );
  // Store the drops too, so a dropped selection cannot return when the first
  // tier's selection later changes. Each pass strictly shrinks the stored picks.
  if (
    tierStates.some(
      ({ orgType, kept }) =>
        kept.length !== picked(pickedFilters, orgType).length,
    )
  ) {
    if (config.hierarchyFilter?.resetPageOnReconcile) resetPage();
    dispatch({ type: "reconcile", selected });
  }
  const selectedRegions = picked(pickedFilters, "region");
  const parentOrgIds = useMemo(() => {
    if (config.filters === "region")
      return selectedRegions.map((region) => region.id);
    if (config.filters !== "hierarchy") return undefined;
    return getHierarchyParentOrgIds({
      tiers: config.hierarchyFilter.tiers,
      match: config.hierarchyFilter.match,
      selected,
      hierarchyOrgs,
      orgById,
    });
  }, [config, selectedRegions, selected, hierarchyOrgs, orgById]);
  const toggle = (orgType: OrgType, org: Org) => {
    dispatch({
      type: "toggle",
      orgType,
      org,
      prune: { tiers: tiers.slice(tiers.indexOf(orgType) + 1), orgById },
    });
    resetPage();
  };
  const filterControls: OrgFilterControl[] = tierStates.map(
    ({ orgType, offered, kept }) => ({
      orgType,
      label: orgTypeDisplay[orgType].label,
      orgs: offered,
      selected: kept,
      onToggle: (org) => toggle(orgType, org),
    }),
  );
  return {
    orgById,
    filterControls,
    selectedRegions,
    toggle,
    selectedStatuses,
    setSelectedStatuses,
    onlyMine,
    setOnlyMine,
    parentOrgIds,
    activeFilterCount:
      selectedStatuses.length +
      tierStates.reduce((count, { kept }) => count + kept.length, 0) +
      selectedRegions.length +
      (onlyMine ? 1 : 0),
    reset: () => {
      dispatch({ type: "reset" });
      setSelectedStatuses(["active"]);
      setOnlyMine(true);
      resetPage();
    },
  };
}
