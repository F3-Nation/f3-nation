import { describe, expect, it } from "vitest";

import { UserRole } from "@acme/shared/app/enums";

import {
  ADMIN_VISIBLE_ROLES,
  isAdminRoleName,
  toGrantableRoleEntries,
} from "./session";

describe("admin role visibility", () => {
  it("only surfaces the currently-active roles", () => {
    expect([...ADMIN_VISIBLE_ROLES]).toEqual(["user", "editor", "admin"]);
  });

  it("never exposes the dormant password roles", () => {
    const dormant = UserRole.filter(
      (role) => !ADMIN_VISIBLE_ROLES.includes(role as never),
    );
    // Guards against a future enum addition silently becoming visible.
    expect(dormant).toEqual(["password_manager", "password_reader"]);
    for (const role of dormant) {
      expect(isAdminRoleName(role)).toBe(false);
    }
  });

  it("accepts the visible roles and rejects unknown/empty values", () => {
    for (const role of ADMIN_VISIBLE_ROLES) {
      expect(isAdminRoleName(role)).toBe(true);
    }
    expect(isAdminRoleName(null)).toBe(false);
    expect(isAdminRoleName(undefined)).toBe(false);
    expect(isAdminRoleName("")).toBe(false);
    expect(isAdminRoleName("superuser")).toBe(false);
  });
});

describe("toGrantableRoleEntries", () => {
  it("keeps grantable assignments and drops dormant ones", () => {
    const result = toGrantableRoleEntries([
      { orgId: 1, roleName: "admin" },
      { orgId: 2, roleName: "password_manager" },
      { orgId: 3, roleName: "editor" },
      { orgId: 4, roleName: "password_reader" },
    ]);

    expect(result).toEqual([
      { orgId: 1, roleName: "admin" },
      { orgId: 3, roleName: "editor" },
    ]);
  });

  it("returns an empty list for nullish input", () => {
    expect(toGrantableRoleEntries(null)).toEqual([]);
    expect(toGrantableRoleEntries(undefined)).toEqual([]);
    expect(toGrantableRoleEntries([])).toEqual([]);
  });
});
