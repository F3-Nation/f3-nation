import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRoleGrantOrgs } from "./use-role-grant-orgs";

const mocks = vi.hoisted(() => ({
  orgs: [] as {
    id: number;
    parentId: number | null;
    orgType: string;
    name: string;
    roles: string[];
  }[],
  sessionRoles: [] as { orgId: number; roleName: string }[],
  isError: false,
}));

vi.mock("~/orpc/client", () => ({ client: {} }));
vi.mock("~/utils/hooks/use-fetch-all-pages", () => ({
  useFetchAllPages: () => ({
    data: mocks.isError ? undefined : mocks.orgs,
    isLoading: false,
    isError: mocks.isError,
  }),
}));
vi.mock("~/utils/hooks/use-auth", () => ({
  useAuth: () => ({ session: { roles: mocks.sessionRoles } }),
}));

// F3 Nation > Southeast (sector) > Boone (region); Watauga is a second region.
const tree = [
  { id: 1, parentId: null, orgType: "nation", name: "F3 Nation", roles: [] },
  { id: 2, parentId: 1, orgType: "sector", name: "Southeast", roles: [] },
  { id: 8, parentId: 2, orgType: "region", name: "Boone", roles: [] },
  { id: 9, parentId: 2, orgType: "region", name: "Watauga", roles: [] },
];

const grantOrgIds = () =>
  renderHook(() => useRoleGrantOrgs()).result.current.orgs.map((o) => o.id);

describe("useRoleGrantOrgs", () => {
  beforeEach(() => {
    mocks.orgs = tree;
    mocks.isError = false;
  });

  it("offers every org to an F3 Nation admin", () => {
    mocks.sessionRoles = [{ orgId: 1, roleName: "admin" }];
    expect(grantOrgIds()).toEqual([1, 2, 8, 9]);
  });

  it("offers nothing to an F3 Nation editor, though every org is listed", () => {
    mocks.sessionRoles = [{ orgId: 1, roleName: "editor" }];
    expect(grantOrgIds()).toEqual([]);
  });

  it("offers a sector admin the sector and the orgs below it", () => {
    mocks.orgs = tree.slice(1);
    mocks.sessionRoles = [{ orgId: 2, roleName: "admin" }];
    expect(grantOrgIds()).toEqual([2, 8, 9]);
  });

  it("offers only the orgs under an admin role, not under an editor role", () => {
    mocks.orgs = tree.slice(2);
    mocks.sessionRoles = [
      { orgId: 8, roleName: "admin" },
      { orgId: 9, roleName: "editor" },
      { orgId: 9, roleName: "password_manager" },
    ];
    expect(grantOrgIds()).toEqual([8]);
  });

  it("reports a failed load", () => {
    mocks.isError = true;
    mocks.sessionRoles = [{ orgId: 1, roleName: "admin" }];
    const { result } = renderHook(() => useRoleGrantOrgs());
    expect(result.current).toMatchObject({ orgs: [], isError: true });
  });
});
