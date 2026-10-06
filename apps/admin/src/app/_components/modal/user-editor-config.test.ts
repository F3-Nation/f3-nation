import { describe, expect, it } from "vitest";

import { canEditUserProfile } from "./user-editor-config";

const region = { id: 10, orgType: "region" as const };
const otherRegion = { id: 20, orgType: "region" as const };
const nation = { id: 1, orgType: "nation" as const };

describe("canEditUserProfile", () => {
  it("allows filling in a new user", () => {
    expect(
      canEditUserProfile({ user: {}, sessionUserId: 5, editableOrgs: [] }),
    ).toBe(true);
    expect(
      canEditUserProfile({
        user: undefined,
        sessionUserId: 5,
        editableOrgs: [],
      }),
    ).toBe(true);
  });

  it("allows editing your own profile", () => {
    expect(
      canEditUserProfile({
        user: { id: 5, homeRegionId: otherRegion.id },
        sessionUserId: 5,
        editableOrgs: [region],
      }),
    ).toBe(true);
  });

  it("follows the home region when one is set", () => {
    const user = { id: 7, homeRegionId: region.id, roles: [{ orgId: 20 }] };
    expect(
      canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [region] }),
    ).toBe(true);
    expect(
      canEditUserProfile({
        user,
        sessionUserId: 5,
        editableOrgs: [otherRegion],
      }),
    ).toBe(false);
  });

  it("falls back to the user's role orgs without a home region", () => {
    const user = { id: 7, homeRegionId: null, roles: [{ orgId: region.id }] };
    expect(
      canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [region] }),
    ).toBe(true);
    expect(
      canEditUserProfile({
        user,
        sessionUserId: 5,
        editableOrgs: [otherRegion, nation],
      }),
    ).toBe(false);
  });

  it("needs Nation for a user with no home region and no roles", () => {
    const user = { id: 7, homeRegionId: null, roles: [] };
    expect(
      canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [region] }),
    ).toBe(false);
    expect(
      canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [nation] }),
    ).toBe(true);
  });
});
