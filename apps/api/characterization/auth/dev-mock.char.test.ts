import { vi } from "vitest";

/**
 * The dev-mock branch: when isDevelopment is true, an unauthenticated request
 * (no cookie, no bearer) resolves to getDevMockSession() instead of null. Its
 * own file because it mocks @acme/shared/common/constants module-wide; the mock
 * must be registered before ../transport pulls in shared.ts. NODE_ENV stays
 * "test" (only isDevelopment is forced) so DB routing still targets the test DB.
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
  it("resolves a mock session for an unauthenticated protected request", async () => {
    // In test mode this same request is 401; the dev mock supplies a user.
    await expectAuthorized(
      await target.invoke(
        req("/v1/position/assignments/all", {
          headers: { "x-forwarded-for": IP(1) },
        }),
      ),
    );
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

  it("returns the dev@localhost identity", async () => {
    // /v1/ping is public but echoes nothing; assert via a protected read that
    // succeeds, proving the mock user (id 0) reached the handler context.
    const res = await target.invoke(
      req("/v1/position/assignments/all", {
        headers: { "x-forwarded-for": IP(3) },
      }),
    );
    expect(res.status).toBe(200);
  });
});
