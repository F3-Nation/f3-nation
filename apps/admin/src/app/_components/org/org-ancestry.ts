import { OrgType } from "@acme/shared/app/enums";

export interface OrgHierarchyNode {
  id: number;
  parentId: number | null;
  // Keep fixture nodes open to hierarchy types that have not landed yet.
  orgType: string;
}

const NO_MATCHING_PARENT_ORG_ID = -1;

export const getAdminHierarchyOrgTypes = <T extends string>(
  orgTypes: readonly T[],
) =>
  // New non-AO/region org types are assumed to be structural levels between
  // areas and the root, so future levels are included without ordering rules.
  //
  // This exclusion rule is a placeholder for the shared hierarchy config in
  // #916, which derives rank from OrgType's array position. Replace it with a
  // rank comparison once that lands rather than adding types to this filter.
  orgTypes.filter((orgType) => orgType !== "ao" && orgType !== "region");

export const AdminHierarchyOrgTypes = getAdminHierarchyOrgTypes(OrgType);
export const AdminAreaAncestorOrgTypes = AdminHierarchyOrgTypes.filter(
  (orgType) => orgType !== "area",
);

export const getOrgById = <T extends OrgHierarchyNode>(orgs: readonly T[]) =>
  new Map(orgs.map((org) => [org.id, org]));

// Compare by ID, never by reference: a query refetch replaces org objects, and
// a reference check would leave a filter visibly selected but undeselectable.
export const isOrgSelected = (
  selected: readonly { id: number }[],
  org: { id: number },
) => selected.some((candidate) => candidate.id === org.id);

export const getParentOrgIdsForFilter = (
  directlySelectedIds: readonly number[],
  hasAncestorSelection: boolean,
  matchingParentIds: readonly number[] | undefined,
) => {
  if (directlySelectedIds.length > 0) return [...directlySelectedIds];
  if (!hasAncestorSelection) return undefined;

  return matchingParentIds?.length
    ? [...matchingParentIds]
    : [NO_MATCHING_PARENT_ORG_ID];
};

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

export const findAncestorByType = <T extends OrgHierarchyNode>(
  org: T,
  orgType: (typeof OrgType)[number],
  orgById: ReadonlyMap<number, T>,
) => {
  const visited = new Set<number>([org.id]);
  let parentId = org.parentId;

  while (parentId !== null) {
    if (visited.has(parentId)) return undefined;

    visited.add(parentId);
    const parent = orgById.get(parentId);
    if (!parent) return undefined;
    if (parent.orgType === orgType) return parent;

    parentId = parent.parentId;
  }

  return undefined;
};
