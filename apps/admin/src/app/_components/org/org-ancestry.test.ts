import { describe, expect, it } from "vitest";

import type { OrgHierarchyNode } from "./org-ancestry";
import {
  findAncestorByType,
  getAdminHierarchyOrgTypes,
  getOrgById,
  getParentOrgIdsForFilter,
  isDescendantOfAny,
  isOrgSelected,
} from "./org-ancestry";

const nation = { id: 1, parentId: null, orgType: "nation" };
const sector = { id: 2, parentId: nation.id, orgType: "sector" };
const territory = { id: 3, parentId: sector.id, orgType: "territory" };
const nestedArea = { id: 4, parentId: territory.id, orgType: "area" };
const nestedRegion = { id: 5, parentId: nestedArea.id, orgType: "region" };
const directArea = { id: 6, parentId: sector.id, orgType: "area" };
const directRegion = { id: 7, parentId: directArea.id, orgType: "region" };
const unrelatedSector = { id: 8, parentId: nation.id, orgType: "sector" };

const orgs: OrgHierarchyNode[] = [
  nation,
  sector,
  territory,
  nestedArea,
  nestedRegion,
  directArea,
  directRegion,
  unrelatedSector,
];

describe("org ancestry", () => {
  const orgById = getOrgById(orgs);

  it("matches descendants through an inserted hierarchy level", () => {
    const selectedSectorIds = new Set([sector.id]);

    expect(isDescendantOfAny(nestedArea, selectedSectorIds, orgById)).toBe(
      true,
    );
    expect(isDescendantOfAny(nestedRegion, selectedSectorIds, orgById)).toBe(
      true,
    );
  });

  it("supports mixed direct and territory-parented areas", () => {
    const selectedSectorIds = new Set([sector.id]);

    const matchingAreas = [nestedArea, directArea].filter((area) =>
      isDescendantOfAny(area, selectedSectorIds, orgById),
    );

    expect(matchingAreas).toEqual([nestedArea, directArea]);
    expect(
      getParentOrgIdsForFilter(
        [],
        true,
        matchingAreas.map((area) => area.id),
      ),
    ).toEqual([nestedArea.id, directArea.id]);
    expect(
      isDescendantOfAny(nestedArea, new Set([unrelatedSector.id]), orgById),
    ).toBe(false);
  });

  it("distinguishes no sector filter from a sector with no matching areas", () => {
    expect(getParentOrgIdsForFilter([], false, [])).toBeUndefined();
    expect(getParentOrgIdsForFilter([], true, [])).toEqual([-1]);
    expect(getParentOrgIdsForFilter([], true, undefined)).toEqual([-1]);
  });

  it("finds a typed ancestor at any depth", () => {
    expect(findAncestorByType(nestedArea, "sector", orgById)).toEqual(sector);
    expect(findAncestorByType(directArea, "sector", orgById)).toEqual(sector);
    expect(findAncestorByType(nestedRegion, "area", orgById)).toEqual(
      nestedArea,
    );
  });

  it("terminates when hierarchy data is cyclic", () => {
    const cyclicOrgs: OrgHierarchyNode[] = [
      { id: 20, parentId: 21, orgType: "area" },
      { id: 21, parentId: 20, orgType: "territory" },
    ];
    const cyclicOrgById = getOrgById(cyclicOrgs);

    expect(
      isDescendantOfAny(cyclicOrgs[0]!, new Set([99]), cyclicOrgById),
    ).toBe(false);
    expect(
      findAncestorByType(cyclicOrgs[0]!, "sector", cyclicOrgById),
    ).toBeUndefined();
  });

  it("compares selections by ID rather than object reference", () => {
    // A refetch replaces org objects; a reference check would leave the filter
    // selected but impossible to clear.
    const refetched = { ...sector };

    expect(isOrgSelected([sector], refetched)).toBe(true);
    expect(isOrgSelected([], sector)).toBe(false);
    expect(isOrgSelected([unrelatedSector], sector)).toBe(false);
  });

  it("resolves a typed ancestor through a deactivated intermediate org", () => {
    // The display columns read through this chain, so an inactive area or
    // territory must not blank out a region's sector name.
    const inactiveArea = { id: 30, parentId: sector.id, orgType: "area" };
    const region = { id: 31, parentId: inactiveArea.id, orgType: "region" };
    const withInactive = getOrgById([...orgs, inactiveArea, region]);

    expect(findAncestorByType(region, "area", withInactive)).toEqual(
      inactiveArea,
    );
    expect(findAncestorByType(region, "sector", withInactive)).toEqual(sector);
  });

  it("includes a future intermediate type regardless of enum ordering", () => {
    expect(
      getAdminHierarchyOrgTypes([
        "ao",
        "region",
        "area",
        "sector",
        "nation",
        "territory",
      ]),
    ).toEqual(["area", "sector", "nation", "territory"]);
  });
});
