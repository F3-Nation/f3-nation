import { vi } from "vitest";

/**
 * The dev-mock branch: when isDevelopment is true, an unauthenticated request
 * (no cookie, no bearer) resolves to getDevMockSession() instead of null. Its
 * own file because it mocks @acme/shared/common/constants module-wide; the mock
 * must be registered before ../transport pulls in shared.ts. Only isDevelopment
 * is overridden — the importOriginal() spread is load-bearing, because @acme/db
 * reads isTest from this same module to select TEST_DATABASE_URL. Replacing the
 * factory with a plain object would silently point this file at the dev DB.
 */
vi.mock("@acme/shared/common/constants", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDevelopment: true,
}));

const { req, target } = await import("../transport");
const { expectAuthorized, expectUnauthorized } = await import("./verdict");
const { describe, expect, it } = await import("vitest");

const IP = (n: number) => `10.71.0.${n}`;

describe.runIf(target.inProcess)("dev-mock branch", () => {
  it("reaches a protected handler on an unauthenticated request", async () => {
    // In test mode this same request is 401; the dev mock supplies a user.
    // The mock's claimed identity (dev@localhost, id 0) is NOT asserted: no
    // endpoint echoes the session principal — /assignments/all returns only
    // { assignments } scoped by getEditableOrgIdsForUser — so a 200 proves
    // authorization reached the handler, and nothing about who it resolved to.
    const res = await target.invoke(
      req("/v1/position/assignments/all", {
        headers: { "x-forwarded-for": IP(1) },
      }),
    );
    await expectAuthorized(res);
    expect(res.status).toBe(200);
  });

  it("does NOT grant admin — the mock session carries no roles", async () => {
    // getDevMockSession returns roles: [], so admin/editor guards still 401
    // despite the code comment claiming 'admin access to all endpoints'.
    await expectUnauthorized(
      await target.invoke(
        req("/v1/api-key", { headers: { "x-forwarded-for": IP(2) } }),
      ),
      "Unauthorized",
    );
  });
});
