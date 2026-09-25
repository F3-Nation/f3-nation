import { describe, expect, it, vi } from "vitest";

import { isNationAdminForUser } from "../../src/lib/better-auth";

// A real live-Postgres test isn't viable here: apps/auth has no DB-reset/
// migration wiring of its own, and CI's test-coverage job runs `turbo test`
// across every workspace concurrently — packages/api's vitest globalSetup is
// what resets/migrates the shared f3_test DB, with no ordering guarantee
// relative to apps/auth's own test run. A query against real orgs/roles
// tables here would be racing that reset, not exercising it. This fakes just
// the chained query-builder shape isNationAdminForUser calls, so the
// function's own join/select/mapping logic still runs for real.
interface RoleRow {
  orgId: number;
  orgName: string | null;
  roleName: string;
}

function fakeDb(rows: RoleRow[]) {
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return query as unknown as Parameters<typeof isNationAdminForUser>[0];
}

describe("isNationAdminForUser", () => {
  it("returns true when the user has the admin role on the F3 Nation org", async () => {
    const db = fakeDb([{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }]);

    await expect(isNationAdminForUser(db, 42)).resolves.toBe(true);
  });

  it("returns false when the user has no roles", async () => {
    const db = fakeDb([]);

    await expect(isNationAdminForUser(db, 42)).resolves.toBe(false);
  });

  it("returns false when the user is only an admin of a non-Nation org", async () => {
    const db = fakeDb([
      { orgId: 2, orgName: "Some Region", roleName: "admin" },
    ]);

    await expect(isNationAdminForUser(db, 42)).resolves.toBe(false);
  });

  it("returns false when the user has a non-admin role on the F3 Nation org", async () => {
    const db = fakeDb([{ orgId: 1, orgName: "F3 Nation", roleName: "member" }]);

    await expect(isNationAdminForUser(db, 42)).resolves.toBe(false);
  });
});
