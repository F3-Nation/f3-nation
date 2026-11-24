import { describe, expect, it, vi } from "vitest";

import { canEditOrg } from "./org-access";

// AO 40 → region 30 → area 20 → nation 1; region 31 is a sibling.
const parents: Record<number, number | null> = {
  40: 30,
  30: 20,
  31: 20,
  20: 1,
  1: null,
};
const getParentId = (orgId: number) => Promise.resolve(parents[orgId]);

describe("canEditOrg", () => {
  it("allows an editor of the org itself", async () => {
    await expect(
      canEditOrg(30, [{ orgId: 30, roleName: "editor" }], getParentId),
    ).resolves.toBe(true);
  });

  it("allows an admin of an ancestor", async () => {
    await expect(
      canEditOrg(40, [{ orgId: 20, roleName: "admin" }], getParentId),
    ).resolves.toBe(true);
  });

  it("denies an editor of a sibling region", async () => {
    await expect(
      canEditOrg(40, [{ orgId: 31, roleName: "editor" }], getParentId),
    ).resolves.toBe(false);
  });

  it("denies an editor of a child org", async () => {
    await expect(
      canEditOrg(30, [{ orgId: 40, roleName: "editor" }], getParentId),
    ).resolves.toBe(false);
  });

  it("denies a plain user role on the org", async () => {
    const lookup = vi.fn(getParentId);
    await expect(
      canEditOrg(30, [{ orgId: 30, roleName: "user" }], lookup),
    ).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("denies an org that does not exist", async () => {
    await expect(
      canEditOrg(999, [{ orgId: 1, roleName: "admin" }], getParentId),
    ).resolves.toBe(false);
  });

  it("stops on a parent cycle", async () => {
    const cyclic: Record<number, number> = { 5: 6, 6: 5 };
    const lookup = vi.fn((orgId: number) => Promise.resolve(cyclic[orgId]));
    await expect(
      canEditOrg(5, [{ orgId: 1, roleName: "admin" }], lookup),
    ).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
