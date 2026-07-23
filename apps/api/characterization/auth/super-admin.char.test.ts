import { describe, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { req, target } from "../transport";
import { expectAuthorized, expectUnauthorized } from "./verdict";

/**
 * revalidateAuthProcedure: POST /v1/map/revalidate. Authorized either by the
 * SUPER_ADMIN_API_KEY in an x-api-key header OR a nation-admin session. The
 * handler then calls next/cache + an outbound webhook, so an authorized request
 * surfaces as a non-401 (a 500 from those side effects), which expectAuthorized
 * accepts — the point here is the auth decision, not the handler's fate.
 */

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
});
