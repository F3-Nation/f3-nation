import { describe, expect, it } from "vitest";

import type { OrgType } from "@acme/shared/app/enums";

import { compareAssignmentOrgs } from "./assignment-org-order";

describe("assignment org ordering", () => {
  it("places Territory between Sector and Area, with names sorted within a tier", () => {
    const orgs: { orgType: OrgType; name: string }[] = [
      { orgType: "ao", name: "AO" },
      { orgType: "territory", name: "Zulu" },
      { orgType: "area", name: "Area" },
      { orgType: "nation", name: "Nation" },
      { orgType: "territory", name: "Alpha" },
      { orgType: "region", name: "Region" },
      { orgType: "sector", name: "Sector" },
    ];

    expect(
      orgs
        .slice()
        .sort(compareAssignmentOrgs)
        .map((org) => org.name),
    ).toEqual(["Nation", "Sector", "Alpha", "Zulu", "Area", "Region", "AO"]);
  });

  it("keeps unrecognized runtime types last, ordered by name", () => {
    const orgs = [
      { orgType: "division" as OrgType, name: "Zulu" },
      { orgType: "ao" as const, name: "AO" },
      { orgType: "district" as OrgType, name: "Alpha" },
    ];

    expect(
      orgs
        .slice()
        .sort(compareAssignmentOrgs)
        .map((org) => org.name),
    ).toEqual(["AO", "Alpha", "Zulu"]);
  });
});
