import { describe, expect, it } from "vitest";

import {
  canEditUserProfile,
  roleOrgIdsNeedingParent,
} from "./user-editor-config";

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

  it.each([{ id: 7 }, { id: 7, homeRegionId: null, roles: null }])(
    "needs Nation for a user with missing or null roles: %j",
    (user) => {
      expect(
        canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [region] }),
      ).toBe(false);
      expect(
        canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [nation] }),
      ).toBe(true);
    },
  );

  it("counts an AO role through the AO's region", () => {
    const aoId = 101;
    const user = { id: 7, homeRegionId: null, roles: [{ orgId: aoId }] };
    expect(
      canEditUserProfile({ user, sessionUserId: 5, editableOrgs: [region] }),
    ).toBe(false);
    expect(
      canEditUserProfile({
        user,
        sessionUserId: 5,
        editableOrgs: [region],
        roleOrgParentIds: new Map([[aoId, region.id]]),
      }),
    ).toBe(true);
    expect(
      canEditUserProfile({
        user,
        sessionUserId: 5,
        editableOrgs: [otherRegion],
        roleOrgParentIds: new Map([[aoId, region.id]]),
      }),
    ).toBe(false);
  });
});

describe("roleOrgIdsNeedingParent", () => {
  it.each([{}, { homeRegionId: null, roles: null }])(
    "needs no parent lookup when roles are missing or null: %j",
    (user) => {
      expect(roleOrgIdsNeedingParent({ user, editableOrgs: [region] })).toEqual(
        [],
      );
    },
  );

  it("lists only role orgs the caller can't already edit", () => {
    expect(
      roleOrgIdsNeedingParent({
        user: {
          homeRegionId: null,
          roles: [{ orgId: region.id }, { orgId: 101 }, { orgId: 101 }],
        },
        editableOrgs: [region],
      }),
    ).toEqual([101]);
  });

  it("needs nothing when the user has a home region or isn't loaded", () => {
    expect(
      roleOrgIdsNeedingParent({
        user: { homeRegionId: region.id, roles: [{ orgId: 101 }] },
        editableOrgs: [],
      }),
    ).toEqual([]);
    expect(
      roleOrgIdsNeedingParent({ user: undefined, editableOrgs: [] }),
    ).toEqual([]);
  });
});
