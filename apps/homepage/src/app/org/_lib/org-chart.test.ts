import { describe, it, expect } from "vitest";
import type { OrgChartItem } from "./types";
import {
  getDescendants,
  getLevelOrgs,
  getOrgPath,
  nextNavigableLevel,
} from "./navigation";
import {
  LAYER_TYPES,
  normalizeOrgType,
  orgTypeRank,
  buildOrgHierarchy,
} from "./org-chart";

describe("LAYER_TYPES", () => {
  it("excludes ao and nation", () => {
    expect(LAYER_TYPES).not.toContain("ao");
    expect(LAYER_TYPES).not.toContain("nation");
  });

  it("contains region, area, territory, and sector", () => {
    expect(LAYER_TYPES).toContain("region");
    expect(LAYER_TYPES).toContain("area");
    expect(LAYER_TYPES).toContain("territory");
    expect(LAYER_TYPES).toContain("sector");
  });
});

describe("orgTypeRank", () => {
  it("ao has lower rank than region", () => {
    expect(orgTypeRank("ao")).toBeLessThan(orgTypeRank("region"));
  });

  it("region has lower rank than area", () => {
    expect(orgTypeRank("region")).toBeLessThan(orgTypeRank("area"));
  });

  it("area has lower rank than sector", () => {
    expect(orgTypeRank("area")).toBeLessThan(orgTypeRank("sector"));
  });

  it("sector has lower rank than nation", () => {
    expect(orgTypeRank("sector")).toBeLessThan(orgTypeRank("nation"));
  });
});

describe("normalizeOrgType", () => {
  it("returns null for non-strings", () => {
    expect(normalizeOrgType(null)).toBeNull();
    expect(normalizeOrgType(42)).toBeNull();
    expect(normalizeOrgType(undefined)).toBeNull();
    expect(normalizeOrgType({})).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizeOrgType("district")).toBeNull();
    expect(normalizeOrgType("")).toBeNull();
  });

  it("accepts all valid types case-insensitively", () => {
    expect(normalizeOrgType("ao")).toBe("ao");
    expect(normalizeOrgType("region")).toBe("region");
    expect(normalizeOrgType("area")).toBe("area");
    expect(normalizeOrgType("TERRITORY")).toBe("territory");
    expect(normalizeOrgType("sector")).toBe("sector");
    expect(normalizeOrgType("nation")).toBe("nation");
    // Implementation does toLowerCase so uppercase is accepted
    expect(normalizeOrgType("SECTOR")).toBe("sector");
    expect(normalizeOrgType("Region")).toBe("region");
  });

  it("trims whitespace", () => {
    expect(normalizeOrgType("  region  ")).toBe("region");
  });
});

function makeItem(
  orgId: number,
  orgType: OrgChartItem["orgType"],
  hierarchy: OrgChartItem["hierarchy"] = [],
  locations: OrgChartItem["activeLocations"] = [],
): OrgChartItem {
  return {
    orgId,
    name: `Org ${orgId}`,
    orgType,
    hierarchy,
    activeLocations: locations,
  };
}

describe("buildOrgHierarchy", () => {
  it("returns empty maps for empty input", () => {
    const result = buildOrgHierarchy([]);
    expect(result.orgById.size).toBe(0);
    expect(result.pointsById.size).toBe(0);
    expect(result.metricsById.size).toBe(0);
  });

  it("builds a basic org from a single item", () => {
    const items = [makeItem(10, "region", [[1, "Nation", "nation"]])];
    const { orgById } = buildOrgHierarchy(items);
    expect(orgById.get(10)?.orgType).toBe("region");
    expect(orgById.get(10)?.name).toBe("Org 10");
    expect(orgById.get(1)?.orgType).toBe("nation");
    expect(orgById.get(1)?.name).toBe("Nation");
  });

  it("derives parent from first hierarchy entry", () => {
    const items = [
      makeItem(20, "area", [
        [10, "Region One", "region"],
        [1, "Nation", "nation"],
      ]),
    ];
    const { orgById } = buildOrgHierarchy(items);
    expect(orgById.get(20)?.parentId).toBe(10);
    expect(orgById.get(10)?.parentId).toBe(1);
  });

  it("skips items with unrecognized orgType", () => {
    const items = [
      {
        orgId: 99,
        name: "Unknown",
        orgType: "district" as OrgChartItem["orgType"],
        hierarchy: [],
        activeLocations: [],
      },
    ];
    const { orgById } = buildOrgHierarchy(items);
    expect(orgById.has(99)).toBe(false);
  });

  it("skips hierarchy entries with unrecognized orgType", () => {
    const items = [
      {
        orgId: 5,
        name: "Region A",
        orgType: "region" as const,
        hierarchy: [
          [999, "Mystery", "district"] as unknown as [
            number,
            string | null,
            OrgChartItem["orgType"],
          ],
        ],
        activeLocations: [],
      },
    ];
    const { orgById } = buildOrgHierarchy(items);
    expect(orgById.has(5)).toBe(true);
    expect(orgById.has(999)).toBe(false);
    expect(orgById.get(5)?.parentId).toBeNull();
  });

  it.each(["area", "region"] as const)(
    "relinks an area to its sector when an unknown division appears in the %s item",
    (itemType) => {
      // Simulate an API tier that this bundle's OrgType does not yet know.
      const ancestors: OrgChartItem["hierarchy"] = [
        [3, "Division", "division" as OrgChartItem["orgType"]],
        [2, "Sector", "sector"],
        [1, "Nation", "nation"],
      ];
      const item =
        itemType === "area"
          ? makeItem(4, "area", ancestors)
          : makeItem(5, "region", [[4, "Area", "area"], ...ancestors]);
      const { orgById, childrenByParent } = buildOrgHierarchy([item]);

      expect(orgById.has(3)).toBe(false);
      expect(orgById.get(4)?.parentId).toBe(2);
      expect(childrenByParent.get(2)?.map((org) => org.id)).toEqual([4]);
      for (const org of orgById.values()) {
        if (org.parentId !== null) {
          expect(orgById.has(org.parentId)).toBe(true);
        }
      }
    },
  );

  it("skips consecutive unknown ancestors", () => {
    const { orgById } = buildOrgHierarchy([
      makeItem(4, "area", [
        [3, "Division", "division" as OrgChartItem["orgType"]],
        [6, "District", "district" as OrgChartItem["orgType"]],
        [2, "Sector", "sector"],
        [1, "Nation", "nation"],
      ]),
    ]);

    expect(orgById.get(4)?.parentId).toBe(2);
    expect(orgById.has(3)).toBe(false);
    expect(orgById.has(6)).toBe(false);
  });

  it("reduces an unknown six-tier tree to the existing five-tier hierarchy", () => {
    const fiveTierChain: OrgChartItem["hierarchy"] = [
      [5, "Region", "region"],
      [4, "Area", "area"],
      [2, "Sector", "sector"],
      [1, "Nation", "nation"],
    ];
    const sixTierChain: OrgChartItem["hierarchy"] = [
      ...fiveTierChain.slice(0, 2),
      [3, "Division", "division" as OrgChartItem["orgType"]],
      ...fiveTierChain.slice(2),
    ];
    const result = buildOrgHierarchy([makeItem(6, "ao", sixTierChain)]);

    expect(result).toEqual(
      buildOrgHierarchy([makeItem(6, "ao", fiveTierChain)]),
    );
    expect(getOrgPath(6, result.orgById).map((org) => org.id)).toEqual([
      1, 2, 4, 5, 6,
    ]);
    expect(getDescendants(2, result.childrenByParent, new Map())).toEqual([
      2, 4, 5, 6,
    ]);
  });

  it("fills a missing parent from a later item's recognized ancestors", () => {
    const { orgById, childrenByParent } = buildOrgHierarchy([
      makeItem(4, "area"),
      makeItem(5, "region", [
        [4, "Area", "area"],
        [3, "Division", "division" as OrgChartItem["orgType"]],
        [2, "Sector", "sector"],
        [1, "Nation", "nation"],
      ]),
    ]);

    expect(orgById.get(4)).toMatchObject({ name: "Area", parentId: 2 });
    expect(childrenByParent.get(2)?.map((org) => org.id)).toEqual([4]);
    expect(childrenByParent.get(4)?.map((org) => org.id)).toEqual([5]);
    expect(orgById.has(3)).toBe(false);
  });

  it.each([false, true])(
    "retains the first non-null parent across conflicting chains (reversed: %s)",
    (reverse) => {
      const items = [2, 7].map((sectorId, index) =>
        makeItem(10 + index, "region", [
          [4, "Area", "area"],
          [3, "Division", "division" as OrgChartItem["orgType"]],
          [sectorId, `Sector ${sectorId}`, "sector"],
          [1, "Nation", "nation"],
        ]),
      );
      if (reverse) items.reverse();
      const { orgById, childrenByParent } = buildOrgHierarchy(items);
      const retainedParent = reverse ? 7 : 2;
      const otherParent = reverse ? 2 : 7;
      expect(orgById.get(4)?.parentId).toBe(retainedParent);
      expect(
        childrenByParent.get(retainedParent)?.map((org) => org.id),
      ).toEqual([4]);
      expect(childrenByParent.get(otherParent)).toBeUndefined();
      expect(orgById.has(3)).toBe(false);
    },
  );

  it("preserves navigation and region location data after skipping an unknown tier", () => {
    const result = buildOrgHierarchy([
      makeItem(
        5,
        "region",
        [
          [4, "Area", "area"],
          [3, "Division", "division" as OrgChartItem["orgType"]],
          [2, "Sector", "sector"],
          [1, "Nation", "nation"],
        ],
        [
          {
            locationId: 10,
            latitude: 35,
            longitude: -80,
            eventCount: 2,
            aoCount: 1,
          },
        ],
      ),
    ]);
    const { orgById, childrenByParent } = result;
    const sector = orgById.get(2)!;
    const area = orgById.get(4)!;
    const cache = new Map<number, number[]>();

    expect(nextNavigableLevel(sector, orgById, childrenByParent, cache)).toBe(
      "area",
    );
    expect(
      getLevelOrgs("area", [sector], orgById, childrenByParent, cache),
    ).toEqual([area]);
    expect(nextNavigableLevel(area, orgById, childrenByParent, cache)).toBe(
      "region",
    );
    expect(
      getLevelOrgs(
        "region",
        [sector, area],
        orgById,
        childrenByParent,
        cache,
      ).map((org) => org.id),
    ).toEqual([5]);
    expect(result.orgLocationsById.get(5)).toEqual([
      { locationId: 10, lat: 35, lng: -80 },
    ]);
    expect(result.pointsById.get(5)).toEqual([{ lat: 35, lng: -80 }]);
    expect(result.metricsById.get(5)).toEqual({
      events: 2,
      aos: 1,
      locations: 1,
    });
  });

  it("builds childrenByParent correctly", () => {
    const items = [
      makeItem(2, "area", [[1, "Nation", "nation"]]),
      makeItem(3, "area", [[1, "Nation", "nation"]]),
    ];
    const { childrenByParent } = buildOrgHierarchy(items);
    expect(
      childrenByParent
        .get(1)
        ?.map((o) => o.id)
        .sort(),
    ).toEqual([2, 3]);
  });

  it("accumulates points from activeLocations", () => {
    const items = [
      makeItem(
        10,
        "region",
        [],
        [
          {
            locationId: 101,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 2,
            aoCount: 1,
          },
          {
            locationId: 102,
            latitude: 36.0,
            longitude: -81.0,
            eventCount: 1,
            aoCount: 1,
          },
        ],
      ),
    ];
    const { pointsById } = buildOrgHierarchy(items);
    expect(pointsById.get(10)).toHaveLength(2);
  });

  it("accumulates metrics correctly", () => {
    const items = [
      makeItem(
        10,
        "region",
        [],
        [
          {
            locationId: 201,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 5,
            aoCount: 2,
          },
          {
            locationId: 202,
            latitude: 36.0,
            longitude: -81.0,
            eventCount: 3,
            aoCount: 1,
          },
        ],
      ),
    ];
    const { metricsById } = buildOrgHierarchy(items);
    const m = metricsById.get(10);
    expect(m?.events).toBe(8);
    expect(m?.aos).toBe(3);
    expect(m?.locations).toBe(2);
  });

  it("merges co-located records so AOs are not double-counted", () => {
    const items = [
      makeItem(
        10,
        "region",
        [],
        [
          {
            locationId: 401,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 3,
            aoCount: 2,
          },
          {
            locationId: 402,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 4,
            aoCount: 2,
          },
        ],
      ),
    ];
    const { metricsById } = buildOrgHierarchy(items);
    const m = metricsById.get(10);
    // Same coordinate: events sum (3+4), AOs take the max (2, not 4), one place.
    expect(m?.events).toBe(7);
    expect(m?.aos).toBe(2);
    expect(m?.locations).toBe(1);
  });

  it("does not add pointsById entry when activeLocations is empty", () => {
    const items = [makeItem(10, "region")];
    const { pointsById } = buildOrgHierarchy(items);
    expect(pointsById.has(10)).toBe(false);
  });

  it("preserves distinct locations per org (no lat/lng dedup)", () => {
    const items = [
      makeItem(
        10,
        "region",
        [],
        [
          {
            locationId: 301,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 1,
            aoCount: 1,
          },
          {
            locationId: 302,
            latitude: 35.5,
            longitude: -80.5,
            eventCount: 2,
            aoCount: 1,
          },
        ],
      ),
    ];
    const { pointsById, orgLocationsById } = buildOrgHierarchy(items);
    // Both locations contribute points even when sharing coordinates
    expect(pointsById.get(10)).toHaveLength(2);
    // Distinct location IDs are preserved so each renders its own map pin
    expect(orgLocationsById.get(10)?.map((l) => l.locationId)).toEqual([
      301, 302,
    ]);
  });
});
