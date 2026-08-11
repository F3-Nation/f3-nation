import { vi } from "vitest";

/**
 * revalidateAuthProcedure: POST /v1/map/revalidate. Authorized either by the
 * SUPER_ADMIN_API_KEY in an x-api-key header OR a nation-admin session — two
 * separate branches (packages/api/src/shared.ts), both pinned here.
 *
 * The handler's post-auth side effect (triggerMapAppRevalidation) is
 * neutralized so an authorized request settles as a clean 200 rather than
 * depending on a live Map app. Auth resolution stays entirely real — only
 * what runs AFTER the guard is stubbed. The relative path is because
 * @acme/api exports no lib/* subpath.
 */
vi.mock("../../../../packages/api/src/lib/revalidate-map", () => ({
  triggerMapAppRevalidation: vi.fn().mockResolvedValue(undefined),
}));

const { sessionCookie } = await import("../fixtures/cookies");
const { req, target } = await import("../transport");
const { expectAuthorized, expectUnauthorized } = await import("./verdict");
const { describe, it } = await import("vitest");

const IP = (n: number) => `10.69.0.${n}`;
const PATH = "/v1/map/revalidate";

function revalidateReq(ip: number, headers: Record<string, string>): Request {
  return req(PATH, {
    method: "POST",
    headers: {
      "x-forwarded-for": IP(ip),
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}

describe.runIf(target.inProcess)("super-admin revalidate", () => {
  it("authorizes the SUPER_ADMIN_API_KEY via x-api-key", async () => {
    const superKey = process.env.SUPER_ADMIN_API_KEY;
    if (!superKey)
      throw new Error("SUPER_ADMIN_API_KEY is required for this case");
    // This request carries NO session, so it can only reach a 200 through the
    // key comparison. SUPER_ADMIN_API_KEY is .optional() on the server-side
    // t3-env the middleware actually reads; were it absent, the branch would
    // short-circuit and fall through to the `!context.session?.user` throw and
    // this would 401. So a green here proves the comparison ran — which only
    // holds now that the handler's side effects no longer mask it as a 500.
    await expectAuthorized(
      await target.invoke(revalidateReq(1, { "x-api-key": superKey })),
    );
  });

  it("rejects a wrong x-api-key with a generic 401", async () => {
    await expectUnauthorized(
      await target.invoke(
        revalidateReq(2, { "x-api-key": "not-the-super-key" }),
      ),
      "Unauthorized",
    );
  });

  it("rejects a session that is not nation admin, with the exact message", async () => {
    // admin on a non-nation org — authenticated, but not a nation admin.
    const cookie = await sessionCookie({
      roles: [{ orgId: 999, orgName: "Some Region", roleName: "admin" }],
    });
    await expectUnauthorized(
      await target.invoke(revalidateReq(3, { cookie })),
      "You are not authorized to revalidate this Nation",
    );
  });

  it("authorizes a nation-admin session without an x-api-key", async () => {
    // shared.ts duplicates the nation-admin check rather than reusing
    // nationAdminProcedure, so role-guards.char.test.ts does not cover it: a
    // port implementing only the API-key branch would otherwise pass green.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    await expectAuthorized(await target.invoke(revalidateReq(4, { cookie })));
  });
});
