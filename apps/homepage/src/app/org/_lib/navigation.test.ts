import { describe, it, expect } from "vitest";
import type { Org } from "./types";
import {
  getDescendants,
  getLevelOrgs,
  getOrgPath,
  nextNavigableLevel,
  pathForNavigatingTo,
} from "./navigation";

function build(orgs: Org[]) {
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const childrenByParent = new Map<number, Org[]>();
  for (const o of orgs) {
    if (o.parentId == null) continue;
    const list = childrenByParent.get(o.parentId) ?? [];
    list.push(o);
    childrenByParent.set(o.parentId, list);
  }
  return { orgById, childrenByParent, cache: new Map<number, number[]>() };
}

const nation: Org = {
  id: 1,
  parentId: null,
  name: "Nation",
  orgType: "nation",
};
// Normal branch: sector → area → region → ao
const sector: Org = {
  id: 10,
  parentId: 1,
  name: "Mid Atlantic",
  orgType: "sector",
};
const area: Org = { id: 20, parentId: 10, name: "Carolinas", orgType: "area" };
const region: Org = {
  id: 30,
  parentId: 20,
  name: "Charlotte",
  orgType: "region",
};
const ao: Org = { id: 40, parentId: 30, name: "The Chariot", orgType: "ao" };
// Skip branch: an area is missing, so the region hangs directly off the sector
const sectorSkip: Org = {
  id: 11,
  parentId: 1,
  name: "Pacific",
  orgType: "sector",
};
const regionSkip: Org = {
  id: 31,
  parentId: 11,
  name: "Seattle",
  orgType: "region",
};

const allOrgs = [nation, sector, area, region, ao, sectorSkip, regionSkip];

describe("getOrgPath / getDescendants", () => {
  it("returns the root→leaf path", () => {
    const { orgById } = build(allOrgs);
    expect(getOrgPath(30, orgById).map((o) => o.id)).toEqual([1, 10, 20, 30]);
  });

  it("collects an org and all of its descendants", () => {
    const { childrenByParent, cache } = build(allOrgs);
    expect(getDescendants(10, childrenByParent, cache).sort()).toEqual([
      10, 20, 30, 40,
    ]);
  });
});

describe("nextNavigableLevel (skip empty tiers)", () => {
  it("drills a sector to its area layer when the area is populated", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    expect(nextNavigableLevel(sector, orgById, childrenByParent, cache)).toBe(
      "area",
    );
  });

  it("skips the empty area layer and drills straight to region", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    expect(
      nextNavigableLevel(sectorSkip, orgById, childrenByParent, cache),
    ).toBe("region");
  });

  it("returns null for the leaf (view-only) layer", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    expect(nextNavigableLevel(region, orgById, childrenByParent, cache)).toBe(
      null,
    );
  });
});

describe("pathForNavigatingTo", () => {
  it("drills a normal sector to the area level", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    const { path, level } = pathForNavigatingTo(
      sector,
      orgById,
      childrenByParent,
      cache,
    );
    expect(level).toBe("area");
    expect(path.map((o) => o.id)).toEqual([10]);
  });

  it("skips the missing area tier when drilling a sector", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    const { path, level } = pathForNavigatingTo(
      sectorSkip,
      orgById,
      childrenByParent,
      cache,
    );
    expect(level).toBe("region");
    expect(path.map((o) => o.id)).toEqual([11]);
  });

  it("keeps a region view-only (excludes itself from the path)", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    const { path, level } = pathForNavigatingTo(
      region,
      orgById,
      childrenByParent,
      cache,
    );
    expect(level).toBe("region");
    expect(path.map((o) => o.id)).toEqual([10, 20]);
  });
});

describe("getLevelOrgs", () => {
  it("shows regions that hang directly off a sector when the area is skipped", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    const orgs = getLevelOrgs(
      "region",
      [sectorSkip],
      orgById,
      childrenByParent,
      cache,
    );
    expect(orgs.map((o) => o.id)).toEqual([31]);
  });

  it("shows direct children at the drilled level in the normal case", () => {
    const { orgById, childrenByParent, cache } = build(allOrgs);
    const orgs = getLevelOrgs(
      "area",
      [sector],
      orgById,
      childrenByParent,
      cache,
    );
    expect(orgs.map((o) => o.id)).toEqual([20]);
  });
});

describe("getLevelOrgs — International sector", () => {
  const intlSector: Org = {
    id: 50,
    parentId: 1,
    name: "International",
    orgType: "sector",
  };
  const intlArea: Org = {
    id: 52,
    parentId: 50,
    name: "Europe",
    orgType: "area",
  };
  const intlRegion: Org = {
    id: 51,
    parentId: 52,
    name: "London",
    orgType: "region",
  };
  const intlOrgs = [nation, intlSector, intlArea, intlRegion];

  it("shows region descendants even when they are not direct children", () => {
    const { orgById, childrenByParent, cache } = build(intlOrgs);
    const orgs = getLevelOrgs(
      "region",
      [intlSector],
      orgById,
      childrenByParent,
      cache,
    );
    expect(orgs.map((o) => o.id)).toEqual([51]);
  });

  it("shows area descendants of the International sector", () => {
    const { orgById, childrenByParent, cache } = build(intlOrgs);
    const orgs = getLevelOrgs(
      "area",
      [intlSector],
      orgById,
      childrenByParent,
      cache,
    );
    expect(orgs.map((o) => o.id)).toEqual([52]);
  });
});
