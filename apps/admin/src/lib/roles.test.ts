import { describe, expect, it } from "vitest";

import { UserRole } from "@acme/shared/app/enums";

import {
  ROLES_IN_DISPLAY_ORDER,
  assignableRoles,
  badgeClassFor,
  groupRolesByOrg,
  isUserRole,
  roleLabel,
  toRoleAssignments,
  uniqueOrgNames,
} from "./roles";

describe("ROLES_IN_DISPLAY_ORDER", () => {
  it("lists every role once, most access first", () => {
    expect(ROLES_IN_DISPLAY_ORDER).toEqual([
      "admin",
      "editor",
      "password_manager",
      "password_reader",
      "user",
    ]);
    expect([...ROLES_IN_DISPLAY_ORDER].sort()).toEqual([...UserRole].sort());
  });
});

describe("roleLabel", () => {
  it("labels known roles and passes unknown names through", () => {
    expect(roleLabel("password_manager")).toBe("Password Manager");
    expect(roleLabel("password_reader")).toBe("Password Reader");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("comz")).toBe("comz");
    expect(roleLabel(null)).toBe("Unknown");
  });

  it("doesn't treat inherited object keys as roles", () => {
    expect(isUserRole("toString")).toBe(false);
    expect(roleLabel("toString")).toBe("toString");
  });
});

describe("assignableRoles", () => {
  it("offers the password roles on regions only", () => {
    expect(assignableRoles("region")).toEqual([
      "admin",
      "editor",
      "password_manager",
      "password_reader",
    ]);
    expect(assignableRoles("ao")).toEqual(["admin", "editor"]);
    expect(assignableRoles("nation")).toEqual(["admin", "editor"]);
    expect(assignableRoles(undefined)).toEqual(["admin", "editor"]);
  });

  it("never offers the user role", () => {
    expect(assignableRoles("region")).not.toContain("user");
  });
});

describe("groupRolesByOrg", () => {
  it("groups by org in first-seen order, roles most access first", () => {
    expect(
      groupRolesByOrg([
        { orgId: 2, orgName: "Boone", roleName: "password_reader" },
        { orgId: 1, orgName: "F3 Nation", roleName: "editor" },
        { orgId: 2, orgName: "Boone", roleName: "admin" },
        { orgId: 2, orgName: "Boone", roleName: "admin" },
      ]),
    ).toEqual([
      { orgId: 2, orgName: "Boone", roleNames: ["admin", "password_reader"] },
      { orgId: 1, orgName: "F3 Nation", roleNames: ["editor"] },
    ]);
  });

  it("puts role names this build doesn't know last", () => {
    expect(
      groupRolesByOrg([
        { orgId: 1, roleName: "comz" },
        { orgId: 1, roleName: "editor" },
      ])[0]?.roleNames,
    ).toEqual(["editor", "comz"]);
  });
});

describe("badgeClassFor", () => {
  it("uses the first role's style, or a neutral one for an unknown role", () => {
    expect(badgeClassFor(["password_manager", "password_reader"])).toContain(
      "amber",
    );
    expect(badgeClassFor(["comz"])).toContain("bg-muted");
    expect(badgeClassFor([])).toContain("bg-muted");
  });
});

describe("toRoleAssignments", () => {
  it("keeps every role as an org and role pair", () => {
    expect(
      toRoleAssignments([
        { orgId: 1, roleName: "admin" },
        { orgId: 1, roleName: "password_manager" },
      ]),
    ).toEqual([
      { orgId: 1, roleName: "admin" },
      { orgId: 1, roleName: "password_manager" },
    ]);
    expect(toRoleAssignments(null)).toEqual([]);
    expect(toRoleAssignments(undefined)).toEqual([]);
  });
});

describe("uniqueOrgNames", () => {
  it("lists each org once and skips missing names", () => {
    expect(
      uniqueOrgNames([
        { orgName: "Boone" },
        { orgName: null },
        { orgName: "F3 Nation" },
        { orgName: "Boone" },
      ]),
    ).toEqual(["Boone", "F3 Nation"]);
  });
});
