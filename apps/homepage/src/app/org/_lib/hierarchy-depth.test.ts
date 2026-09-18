// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { OrgChartItem, OrgType } from "./types";
import { buildOrgHierarchy, LAYER_TYPES, normalizeOrgType } from "./org-chart";
import {
  getDescendants,
  getLevelOrgs,
  getOrgPath,
  nextNavigableLevel,
} from "./navigation";
import { readLevelFromUrl, readOrgIdFromUrl, writeUrlState } from "./url-state";

const territory: OrgType = "territory";
const ancestors: OrgChartItem["hierarchy"] = [
  [5, "Region", "region"],
  [4, "Area", "area"],
  [3, "Territory", territory],
  [2, "Sector", "sector"],
  [1, "Nation", "nation"],
];
const sixTierItem: OrgChartItem = {
  orgId: 6,
  name: "AO",
  orgType: "ao",
  hierarchy: ancestors,
  activeLocations: [],
};

afterEach(() => window.history.replaceState(null, "", "./"));

describe("recognized sixth tier", () => {
  it("retains the territory and all six levels of ancestry", () => {
    const { orgById, childrenByParent } = buildOrgHierarchy([sixTierItem]);
    expect(normalizeOrgType("territory")).toBe(territory);
    expect(LAYER_TYPES).toEqual(["region", "area", "territory", "sector"]);
    expect(orgById.get(3)).toMatchObject({ orgType: territory, parentId: 2 });
    expect(orgById.get(4)?.parentId).toBe(3);
    expect(getOrgPath(6, orgById).map((org) => org.id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(getDescendants(2, childrenByParent, new Map())).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it("navigates both territory and direct-area branches in a mixed hierarchy", () => {
    const directArea: OrgChartItem = {
      orgId: 7,
      name: "Direct Area",
      orgType: "area",
      hierarchy: [
        [2, "Sector", "sector"],
        [1, "Nation", "nation"],
      ],
      activeLocations: [],
    };
    const { orgById, childrenByParent } = buildOrgHierarchy([
      sixTierItem,
      directArea,
    ]);
    const cache = new Map<number, number[]>();
    const sectorOrg = orgById.get(2)!;
    const territoryOrg = orgById.get(3)!;
    const areaOrg = orgById.get(4)!;
    expect(
      nextNavigableLevel(sectorOrg, orgById, childrenByParent, cache),
    ).toBe(territory);
    expect(
      getLevelOrgs(
        territory,
        [sectorOrg],
        orgById,
        childrenByParent,
        cache,
      ).map((org) => org.id),
    ).toEqual([3]);
    expect(
      nextNavigableLevel(territoryOrg, orgById, childrenByParent, cache),
    ).toBe("area");
    expect(
      getLevelOrgs(
        "area",
        [sectorOrg, territoryOrg],
        orgById,
        childrenByParent,
        cache,
      ).map((org) => org.id),
    ).toEqual([4]);
    expect(
      getLevelOrgs("area", [sectorOrg], orgById, childrenByParent, cache).map(
        (org) => org.id,
      ),
    ).toEqual([7]);
    expect(nextNavigableLevel(areaOrg, orgById, childrenByParent, cache)).toBe(
      "region",
    );
    expect(
      getLevelOrgs(
        "region",
        [sectorOrg, territoryOrg, areaOrg],
        orgById,
        childrenByParent,
        cache,
      ).map((org) => org.id),
    ).toEqual([5]);
  });

  it("skips a recognized but unpopulated territory layer", () => {
    const { orgById, childrenByParent } = buildOrgHierarchy([
      { ...sixTierItem, hierarchy: ancestors.filter(([id]) => id !== 3) },
    ]);
    expect(
      nextNavigableLevel(orgById.get(2)!, orgById, childrenByParent, new Map()),
    ).toBe("area");
    expect(orgById.get(4)?.parentId).toBe(2);
  });

  it("round-trips a territory level and selected organization", () => {
    writeUrlState(territory, 3);
    expect(new URLSearchParams(window.location.search).get("level")).toBe(
      "territories",
    );
    expect(readLevelFromUrl()).toBe(territory);
    expect(readOrgIdFromUrl()).toBe(3);
  });
});
