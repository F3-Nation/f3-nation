import { describe, expect, it } from "vitest";
import { routes } from "@acme/shared/app/constants";
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

  it("filters territories by sector and areas by sector and territory", () => {
    expect(orgAdminConfig.territory.filters).toBe("sector");
    expect(orgAdminConfig.area.filters).toBe("sectorTerritory");
    expect(orgAdminConfig.area.displayAncestors).toEqual([
      "territory",
      "sector",
    ]);
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
