import type { OrgType } from "@acme/shared/app/enums";
import { orgTypesAbove } from "@acme/shared/app/org-hierarchy";

export interface OrgHierarchyNode {
  id: number;
  parentId: number | null;
  // Keep fixture nodes open to hierarchy types that have not landed yet.
  orgType: string;
}

const NO_MATCHING_PARENT_ORG_ID = -1;

// Derived from rank so a new tier is picked up without editing these lists.
export const AdminHierarchyOrgTypes = orgTypesAbove("region");
export const AdminAreaAncestorOrgTypes = orgTypesAbove("area");
// The org types a role or an org filter can be scoped to: every tier above the
// AO leaf.
export const AdminScopeOrgTypes = orgTypesAbove("ao");

export const getOrgById = <T extends OrgHierarchyNode>(orgs: readonly T[]) =>
  new Map(orgs.map((org) => [org.id, org]));

// Compare by ID, never by reference: a query refetch replaces org objects, and
// a reference check would leave a filter visibly selected but undeselectable.
export const isOrgSelected = (
  selected: readonly { id: number }[],
  org: { id: number },
) => selected.some((candidate) => candidate.id === org.id);

export const isDescendantOfAny = <T extends OrgHierarchyNode>(
  org: T,
  ancestorIds: ReadonlySet<number>,
  orgById: ReadonlyMap<number, T>,
) => {
  const visited = new Set<number>([org.id]);
  let parentId = org.parentId;

  while (parentId !== null) {
    if (ancestorIds.has(parentId)) return true;
    if (visited.has(parentId)) return false;

    visited.add(parentId);
    parentId = orgById.get(parentId)?.parentId ?? null;
  }

  return false;
};

// The deepest tier with a selection decides the filter; see OrgHierarchyFilter
// for the policy this applies.
export const getHierarchyParentOrgIds = <
  K extends string,
  T extends OrgHierarchyNode & { isActive: boolean },
>({
  tiers,
  match,
  selected,
  hierarchyOrgs,
  orgById,
}: {
  tiers: readonly K[];
  match: { tiers: readonly K[]; includeInactive: boolean };
  selected: Readonly<Partial<Record<K, readonly T[]>>>;
  hierarchyOrgs: readonly T[] | undefined;
  orgById: ReadonlyMap<number, T>;
}): number[] | undefined => {
  const matchTiers: readonly string[] = match.tiers;
  for (const tier of [...tiers].reverse()) {
    const selectedOrgs = selected[tier];
    if (!selectedOrgs?.length) continue;

    const selectedIds = selectedOrgs.map((org) => org.id);
    if (match.tiers.includes(tier)) return selectedIds;

    const ancestorIds = new Set(selectedIds);
    const expandedIds = hierarchyOrgs
      ?.filter((org) =>
        match.includeInactive
          ? ancestorIds.has(org.id) ||
            isDescendantOfAny(org, ancestorIds, orgById)
          : org.isActive &&
            matchTiers.includes(org.orgType) &&
            isDescendantOfAny(org, ancestorIds, orgById),
      )
      .map((org) => org.id);

    return expandedIds?.length ? expandedIds : [NO_MATCHING_PARENT_ORG_ID];
  }
  return undefined;
};

export const findAncestorByType = <T extends OrgHierarchyNode>(
  org: T,
  orgType: (typeof OrgType)[number],
  orgById: ReadonlyMap<number, T>,
  maxDepth = Infinity,
) => {
  const visited = new Set<number>([org.id]);
  let parentId = org.parentId;
  let depth = 0;

  while (parentId !== null && depth < maxDepth) {
    if (visited.has(parentId)) return undefined;

    depth += 1;
    visited.add(parentId);
    const parent = orgById.get(parentId);
    if (!parent) return undefined;
    if (parent.orgType === orgType) return parent;

    parentId = parent.parentId;
  }

  return undefined;
};
