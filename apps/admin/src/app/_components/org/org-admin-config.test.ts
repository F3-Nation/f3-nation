import { describe, expect, it } from "vitest";
import { routes } from "@acme/shared/app/constants";
import { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { resolveOrgSegment } from "./org-admin-config";

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
