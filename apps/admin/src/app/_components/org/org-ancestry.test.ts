import { describe, expect, it } from "vitest";

import type { OrgHierarchyNode } from "./org-ancestry";
import {
  AdminAreaAncestorOrgTypes,
  AdminHierarchyOrgTypes,
  AdminScopeOrgTypes,
  findAncestorByType,
  getHierarchyParentOrgIds,
  getOrgById,
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
      isDescendantOfAny(nestedArea, new Set([unrelatedSector.id]), orgById),
    ).toBe(false);
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

  describe("getHierarchyParentOrgIds", () => {
    const inactiveTerritory = {
      id: 40,
      parentId: sector.id,
      orgType: "territory",
      isActive: false,
    };
    const inactiveArea = {
      id: 41,
      parentId: sector.id,
      orgType: "area",
      isActive: false,
    };
    const withStatus = (org: OrgHierarchyNode) => ({ ...org, isActive: true });
    const hierarchy = [
      withStatus(nation),
      withStatus(sector),
      withStatus(territory),
      withStatus(nestedArea),
      withStatus(directArea),
      withStatus(unrelatedSector),
      inactiveTerritory,
      inactiveArea,
    ];
    const hierarchyById = getOrgById(hierarchy);
    const base = { hierarchyOrgs: hierarchy, orgById: hierarchyById };
    const tiers = ["sector", "territory"];

    it("applies no filter while nothing is selected", () => {
      expect(
        getHierarchyParentOrgIds({
          ...base,
          tiers,
          match: { tiers: ["territory"], includeInactive: true },
          selected: {},
        }),
      ).toBeUndefined();
    });

    it("sends a selection in a match tier as-is", () => {
      expect(
        getHierarchyParentOrgIds({
          ...base,
          tiers,
          match: { tiers: ["territory"], includeInactive: true },
          selected: {
            sector: [withStatus(sector)],
            territory: [withStatus(territory)],
          },
        }),
      ).toEqual([territory.id]);
    });

    it("expands a selection through inactive descendants when allowed", () => {
      expect(
        getHierarchyParentOrgIds({
          ...base,
          tiers,
          match: { tiers: ["territory"], includeInactive: true },
          selected: { sector: [withStatus(sector)] },
        }),
      ).toEqual([
        sector.id,
        territory.id,
        nestedArea.id,
        directArea.id,
        inactiveTerritory.id,
        inactiveArea.id,
      ]);
    });

    it("expands only to active orgs of the match tiers otherwise", () => {
      expect(
        getHierarchyParentOrgIds({
          ...base,
          tiers: ["sector", "area"],
          match: { tiers: ["area"], includeInactive: false },
          selected: { sector: [withStatus(sector)] },
        }),
      ).toEqual([nestedArea.id, directArea.id]);
    });

    it("matches nothing rather than everything when the expansion is empty", () => {
      expect(
        getHierarchyParentOrgIds({
          ...base,
          tiers: ["sector", "area"],
          match: { tiers: ["area"], includeInactive: false },
          selected: { sector: [withStatus(unrelatedSector)] },
        }),
      ).toEqual([-1]);
      expect(
        getHierarchyParentOrgIds({
          ...base,
          hierarchyOrgs: undefined,
          tiers,
          match: { tiers: ["territory"], includeInactive: true },
          selected: { sector: [withStatus(sector)] },
        }),
      ).toEqual([-1]);
    });
  });

  it("derives the admin hierarchy types from rank rather than a hand-written list", () => {
    expect(AdminHierarchyOrgTypes).toEqual([
      "area",
      "territory",
      "sector",
      "nation",
    ]);
    expect(AdminAreaAncestorOrgTypes).toEqual([
      "territory",
      "sector",
      "nation",
    ]);
    expect(AdminScopeOrgTypes).toEqual([
      "region",
      "area",
      "territory",
      "sector",
      "nation",
    ]);
  });
});
