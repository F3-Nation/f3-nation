import type { Org, OrgType } from "./types";
import { LAYER_TYPES, orgTypeRank } from "./org-chart";

export function isInternationalSector(org: Org): boolean {
  return (
    org.orgType === "sector" &&
    org.name.trim().toLowerCase() === "international"
  );
}

export function isGeneralInternationalArea(org: Org): boolean {
  return (
    org.orgType === "area" &&
    org.name.trim().toLowerCase() === "general international area"
  );
}

export function getDescendants(
  orgId: number,
  childrenByParent: Map<number, Org[]>,
  cache: Map<number, number[]>,
): number[] {
  const cached = cache.get(orgId);
  if (cached) return cached;
  const children = childrenByParent.get(orgId) ?? [];
  const ids = [
    orgId,
    ...children.flatMap((c) => getDescendants(c.id, childrenByParent, cache)),
  ];
  cache.set(orgId, ids);
  return ids;
}

export function getOrgPath(orgId: number, orgById: Map<number, Org>): Org[] {
  const path: Org[] = [];
  let current = orgById.get(orgId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? orgById.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * When drilling into `org`, the next more-specific level (lower LAYER_TYPES
 * index) that actually has orgs beneath it. Depth-agnostic: a tier that is
 * unpopulated for this branch (e.g. an area layer skipped between sector and
 * region) is stepped over so navigation never strands on an empty level.
 * Returns null when `org` is a leaf/non-navigable layer or has no descendants.
 */
export function nextNavigableLevel(
  org: Org,
  orgById: Map<number, Org>,
  childrenByParent: Map<number, Org[]>,
  descendantCache: Map<number, number[]>,
): OrgType | null {
  const orgLayerIdx = LAYER_TYPES.indexOf(org.orgType);
  if (orgLayerIdx <= 0) return null;
  const descendants = new Set(
    getDescendants(org.id, childrenByParent, descendantCache),
  );
  for (let i = orgLayerIdx - 1; i >= 0; i--) {
    const level = LAYER_TYPES[i]!;
    const hasOrgs = [...orgById.values()].some(
      (o) => o.orgType === level && o.id !== org.id && descendants.has(o.id),
    );
    if (hasOrgs) return level;
  }
  return null;
}

/** Orgs to show at the current level given the navigation state. */
export function getLevelOrgs(
  level: OrgType,
  selectedPath: Org[],
  orgById: Map<number, Org>,
  childrenByParent: Map<number, Org[]>,
  descendantCache: Map<number, number[]>,
): Org[] {
  if (
    !selectedPath.length ||
    orgTypeRank(level) >=
      orgTypeRank(selectedPath[selectedPath.length - 1]!.orgType)
  ) {
    // Top-level or wider than current selection: show all of this type
    return [...orgById.values()].filter((o) => o.orgType === level);
  }

  const parent = selectedPath[selectedPath.length - 1]!;

  // International sector: its descendants don't nest cleanly through the middle
  // layers, so for any sub-level show every descendant of that type rather
  // than only direct children.
  if (
    isInternationalSector(parent) &&
    orgTypeRank(level) < orgTypeRank(parent.orgType)
  ) {
    const ids = new Set(
      getDescendants(parent.id, childrenByParent, descendantCache),
    );
    return [...orgById.values()].filter(
      (o) => o.orgType === level && ids.has(o.id),
    );
  }

  // If we navigated into a region, show sibling regions
  if (level === "region" && parent.orgType === "region") {
    return [...orgById.values()].filter(
      (o) => o.orgType === "region" && o.parentId === parent.parentId,
    );
  }

  return [...orgById.values()].filter(
    (o) => o.orgType === level && o.parentId === parent.id,
  );
}

/**
 * Depth-agnostic: compute path + level when navigating to an org.
 * LAYER_TYPES is ordered leaf→root. A lower index = more specific.
 */
export function pathForNavigatingTo(
  org: Org,
  orgById: Map<number, Org>,
  childrenByParent: Map<number, Org[]>,
  descendantCache: Map<number, number[]>,
): { path: Org[]; level: OrgType } {
  const fullPath = getOrgPath(org.id, orgById);
  const nonNation = fullPath.filter((o) => o.orgType !== "nation");
  const orgLayerIdx = LAYER_TYPES.indexOf(org.orgType);

  if (orgLayerIdx === -1) {
    // Not a navigable layer type; show context without this org
    return { path: nonNation.slice(0, -1), level: org.orgType };
  }

  if (orgLayerIdx === 0) {
    // Most-specific layer (e.g. region): view-only, keep ancestors in path
    const pathWithoutLeaf = nonNation.filter(
      (o) => LAYER_TYPES.indexOf(o.orgType) > orgLayerIdx,
    );
    return { path: pathWithoutLeaf, level: LAYER_TYPES[0]! };
  }

  // Drill: next level is the closest more-specific tier that has orgs,
  // stepping over any empty tier in between.
  const nextLevel =
    nextNavigableLevel(org, orgById, childrenByParent, descendantCache) ??
    LAYER_TYPES[orgLayerIdx - 1]!;
  const pathToOrg = nonNation.filter(
    (o) => LAYER_TYPES.indexOf(o.orgType) >= orgLayerIdx,
  );
  return { path: pathToOrg, level: nextLevel };
}
