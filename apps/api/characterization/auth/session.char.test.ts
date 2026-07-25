import { describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { req, target } from "../transport";
import { expectAuthorized, expectUnauthorized } from "./verdict";

/**
 * Cookie-session resolution and the bearer/Client-header rules. `/v1/api-key` is
 * adminProcedure; a nation-admin cookie authorizes it (roles ride on the token,
 * so no DB is touched — see cookies.ts).
 */

const IP = (n: number) => `10.68.0.${n}`;
const ADMIN_COOKIE_ROLES = [
  { orgId: 1, orgName: "F3 Nation", roleName: "admin" as const },
];

describe.runIf(target.inProcess)("session and header rules", () => {
  it("authorizes a valid session cookie", async () => {
    const cookie = await sessionCookie({ roles: ADMIN_COOKIE_ROLES });
    await expectAuthorized(
      await target.invoke(
        req("/v1/api-key", { headers: { "x-forwarded-for": IP(1), cookie } }),
      ),
    );
  });

  it("rejects a tampered cookie with 401, not 500", async () => {
    const cookie =
      (await sessionCookie({ roles: ADMIN_COOKIE_ROLES })) + "tamper";
    await expectUnauthorized(
      await target.invoke(
        req("/v1/api-key", { headers: { "x-forwarded-for": IP(2), cookie } }),
      ),
      "Unauthorized",
    );
  });

  it("prefers the cookie over a bearer token when both are present", async () => {
    // #646 replaces auth() with getSessionFromHeaders and must preserve this
    // ordering: a valid cookie wins even beside an invalid bearer.
    const cookie = await sessionCookie({ roles: ADMIN_COOKIE_ROLES });
    await expectAuthorized(
      await target.invoke(
        req("/v1/api-key", {
          headers: {
            "x-forwarded-for": IP(3),
            cookie,
            authorization: "Bearer definitely-not-a-real-key",
            client: "characterization",
          },
        }),
      ),
    );
  });

  it("rejects a bearer token sent without a Client header, with the exact message", async () => {
    await expectUnauthorized(
      await target.invoke(
        req("/v1/api-key", {
          headers: {
            "x-forwarded-for": IP(4),
            authorization: "Bearer some-key",
          },
        }),
      ),
      "Invalid or expired bearer token. Or, if using API Key auth, ensure the 'client' header is set.",
    );
  });

  // The SSG skip-auth branch only fires for oRPC-client dispatch, and a REST
  // request carrying Client: orpc-ssg routes to the RPC handler, which cannot
  // match a plain GET and returns 404 before auth runs. The skip-auth SEMANTICS
  // (cookie ignored, API key honored) require a real RPC frame and are pinned in
  // the wire matrix (Phase C); here we pin only the dispatch consequence.
  // Deliberately unauthenticated: with a valid cookie a 404 would only show
  // that dispatch failed after an authorized request. With no credentials at
  // all, 404-rather-than-401 is what distinguishes dispatch-before-auth.
  it("routes an orpc-ssg REST request to the RPC handler (404 before auth)", async () => {
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: { "x-forwarded-for": IP(5), client: "orpc-ssg" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
