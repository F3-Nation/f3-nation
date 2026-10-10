import { describe, expect, it } from "vitest";
import { routes } from "@acme/shared/app/constants";
import { ORG_ALL_SORT_IDS } from "@acme/shared/app/org-sorting";
import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay, orgTypesAbove } from "@acme/shared/app/org-hierarchy";
import { orgAdminConfig, resolveOrgSegment } from "./org-admin-config";

// Keep this independent of orgTypeDisplay so an accidental configuration
// collision with an existing non-org route cannot filter itself out.
const orgRouteKeys = new Set([
  "theNation",
  "sectors",
  "territories",
  "areas",
  "regions",
  "aos",
]);
const nonOrgSegments = [
  "api",
  "auth",
  ...Object.entries(routes.admin).flatMap(([key, route]) =>
    typeof route === "object" && !orgRouteKeys.has(key)
      ? [route.__path.split("/")[1]!]
      : [],
  ),
];

describe("organization route boundary", () => {
  it("resolves Territory between Area and Sector with the selected icon", () => {
    expect(OrgType).toEqual([
      "ao",
      "region",
      "area",
      "territory",
      "sector",
      "nation",
    ]);
    expect(resolveOrgSegment("territories")).toBe("territory");
    expect(orgTypeDisplay.territory.icon).toBe("LandPlot");
  });

  it.each(nonOrgSegments)(
    "does not claim the existing /%s route",
    (segment) => {
      expect(resolveOrgSegment(segment)).toBeUndefined();
    },
  );
});

describe("organization table ancestry configuration", () => {
  it.each(OrgType)("%s displays and fetches only types above it", (orgType) => {
    const config = orgAdminConfig[orgType];
    const above = orgTypesAbove(orgType);

    for (const ancestor of config.displayAncestors ?? []) {
      expect(above).toContain(ancestor);
      expect(config.ancestorTypes).toContain(ancestor);
    }
    for (const ancestor of config.ancestorTypes ?? []) {
      expect(above).toContain(ancestor);
    }
  });

  it("declares each table's filter tiers and active/inactive policy", () => {
    expect(orgAdminConfig.territory.hierarchyFilter).toEqual({
      tiers: ["sector"],
      match: { tiers: [], includeInactive: true },
    });
    expect(orgAdminConfig.area.hierarchyFilter).toEqual({
      tiers: ["sector", "territory"],
      match: { tiers: ["territory"], includeInactive: true },
    });
    expect(orgAdminConfig.region.hierarchyFilter).toEqual({
      tiers: ["sector", "territory", "area"],
      resetPageOnReconcile: true,
      match: { tiers: [], includeInactive: true },
    });
    expect(orgAdminConfig.area.displayAncestors).toEqual([
      "territory",
      "sector",
    ]);
  });

  it.each(OrgType)("%s has a coherent filter declaration", (orgType) => {
    const { filters, hierarchyFilter, ancestorTypes } = orgAdminConfig[orgType];

    expect(filters === "hierarchy").toBe(hierarchyFilter !== undefined);
    if (!hierarchyFilter) return;

    const topDown = hierarchyFilter.tiers.map((tier) => OrgType.indexOf(tier));
    expect([...topDown].sort((a, b) => b - a)).toEqual(topDown);
    expect(new Set(topDown).size).toBe(topDown.length);
    for (const tier of hierarchyFilter.tiers) {
      expect(orgTypesAbove(orgType)).toContain(tier);
      expect(ancestorTypes).toContain(tier);
    }
    for (const tier of hierarchyFilter.match.tiers) {
      expect(hierarchyFilter.tiers).toContain(tier);
    }
  });

  it("maps only Area ancestors to the new server sort ids", () => {
    for (const orgType of OrgType) {
      const config = orgAdminConfig[orgType];
      for (const ancestor of config.displayAncestors ?? []) {
        const column = config.columns.find((item) => item.key === ancestor);
        expect(column?.id).toBe(
          orgType === "area" ? `${ancestor}Name` : undefined,
        );
      }
    }
  });
});

// API's mapping is exhaustively typed against the same list.
it("uses supported API keys for every server-sorted ancestor column", () => {
  for (const config of Object.values(orgAdminConfig)) {
    if (!config.serverSorting) continue;
    for (const column of config.columns) {
      expect(ORG_ALL_SORT_IDS).toContain(column.id ?? column.key);
    }
  }
});
