import { describe, it, expect } from "vitest";
import type { OrgChartItem } from "./types";
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

  it("contains region, area, and sector", () => {
    expect(LAYER_TYPES).toContain("region");
    expect(LAYER_TYPES).toContain("area");
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
          { latitude: 35.5, longitude: -80.5, eventCount: 2, aoCount: 1 },
          { latitude: 36.0, longitude: -81.0, eventCount: 1, aoCount: 1 },
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
          { latitude: 35.5, longitude: -80.5, eventCount: 5, aoCount: 2 },
          { latitude: 36.0, longitude: -81.0, eventCount: 3, aoCount: 1 },
        ],
      ),
    ];
    const { metricsById } = buildOrgHierarchy(items);
    const m = metricsById.get(10);
    expect(m?.events).toBe(8);
    expect(m?.aos).toBe(3);
    expect(m?.locations).toBe(2);
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
          { latitude: 35.5, longitude: -80.5, eventCount: 1, aoCount: 1 },
          { latitude: 35.5, longitude: -80.5, eventCount: 2, aoCount: 1 },
        ],
      ),
    ];
    const { pointsById } = buildOrgHierarchy(items);
    // Both locations contribute points even when sharing coordinates
    expect(pointsById.get(10)).toHaveLength(2);
  });
});
