import { OrgType } from "@acme/shared/app/enums";
import { isPermittedOrgParent } from "@acme/shared/app/org-hierarchy";
import { describe, expect, it } from "vitest";

import { orgEditorConfig } from "./org-editor-config";

describe("orgEditorConfig parent types", () => {
  it.each(OrgType)(
    "offers only parents the server accepts for %s",
    (orgType) => {
      for (const parent of orgEditorConfig[orgType].parentTypes) {
        expect(isPermittedOrgParent(parent, orgType)).toBe(true);
      }
    },
  );

  it("offers both a sector and a territory as an area's parent, sector first", () => {
    expect(orgEditorConfig.area.parentTypes).toEqual(["sector", "territory"]);
  });

  it("offers both an area and a territory as a region's parent, area first", () => {
    expect(orgEditorConfig.region.parentTypes).toEqual(["area", "territory"]);
  });

  it("preserves the other editors' parent choices", () => {
    expect(
      Object.fromEntries(
        OrgType.filter(
          (orgType) => orgType !== "area" && orgType !== "region",
        ).map((orgType) => [orgType, orgEditorConfig[orgType].parentTypes]),
      ),
    ).toEqual({
      ao: ["region"],
      territory: ["sector"],
      sector: ["nation"],
      nation: [],
    });
  });
});
