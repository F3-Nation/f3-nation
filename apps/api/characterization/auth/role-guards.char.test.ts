import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKey } from "../fixtures/api-keys";
import { sessionCookie } from "../fixtures/cookies";
import { generateForeignKey, signFixtureJwt } from "../fixtures/jwt";
import { createFixtureUser } from "../fixtures/users";
import { req, target } from "../transport";
import { expectAuthorized, expectUnauthorized } from "./verdict";

/**
 * Every guard driven through REAL session resolution, not injected sessions.
 * Representative endpoint per guard, chosen to have no trailing slash (the seam
 * 308s those) and, where possible, a clean 200 on success:
 *
 *   protected      GET  /v1/position/assignments/all
 *   editor         POST /v1/position/assignments   (authorized -> 400 validation)
 *   admin          GET  /v1/api-key
 *   nationAdmin    GET  /v1/mail/templates
 *
 * revalidateAuth is characterized separately in super-admin.char.test.ts.
 */

const IP = (n: number) => `10.64.0.${n}`;
// roleName "admin" + orgId 1 + a name containing "f3 nation" — all three
// conjuncts (role-checks.ts) — is the ONLY shape that satisfies
// isNationAdminFromSession; see the nationAdmin cases below for why a DB-backed
// role cannot reproduce it under the seeded data.
const NATION_ADMIN_COOKIE = [
  { orgId: 1, orgName: "F3 Nation", roleName: "admin" as const },
];

interface Case {
  ip: number;
  method?: "GET" | "POST";
  bearer?: string;
  cookie?: string;
}

/**
 * Build the request with headers correctly nested under `headers`. A flat object
 * passed as the second arg of `req()` is RequestInit, whose stray keys are
 * silently ignored — which reads as an unauthenticated 401, not a header.
 */
function guardReq(path: string, c: Case): Request {
  const headers: Record<string, string> = { "x-forwarded-for": IP(c.ip) };
  if (c.bearer) {
    headers.authorization = `Bearer ${c.bearer}`;
    headers.client = "characterization";
  }
  if (c.cookie) headers.cookie = c.cookie;
  const method = c.method ?? "GET";
  if (method === "POST") headers["content-type"] = "application/json";
  return req(path, {
    method,
    headers,
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

describe.runIf(target.inProcess)("role guards through real resolution", () => {
  let adminKey: Awaited<ReturnType<typeof createApiKey>>;
  let editorKey: Awaited<ReturnType<typeof createApiKey>>;
  let userKey: Awaited<ReturnType<typeof createApiKey>>;
  let jwtUser: Awaited<ReturnType<typeof createFixtureUser>>;

  beforeAll(async () => {
    adminKey = await createApiKey({ roles: [{ roleName: "admin" }] });
    editorKey = await createApiKey({ roles: [{ roleName: "editor" }] });
    userKey = await createApiKey({ roles: [] });
    jwtUser = await createFixtureUser({ roles: [{ roleName: "admin" }] });
  });

  // Settled, not sequential — see api-key.char.test.ts for why a stranded
  // cleanup surfaces as a golden diff in an unrelated file.
  afterAll(async () => {
    const results = await Promise.allSettled(
      [adminKey, editorKey, userKey, jwtUser].map((f) => f?.cleanup()),
    );
    const failed = results.filter((r) => r.status === "rejected");
    // eslint-disable-next-line vitest/no-standalone-expect -- intentional: asserts in afterAll, not a test block
    expect(
      failed,
      `fixture cleanup leaked rows: ${JSON.stringify(failed)}`,
    ).toHaveLength(0);
  });

  describe("protected GET /v1/position/assignments/all", () => {
    const PATH = "/v1/position/assignments/all";

    it("rejects with no auth", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 1 })),
        "Unauthorized",
      );
    });

    it("authorizes a user-role key (any authenticated principal passes)", async () => {
      await expectAuthorized(
        await target.invoke(guardReq(PATH, { ip: 2, bearer: userKey.key })),
      );
    });
  });

  describe("editor POST /v1/position/assignments", () => {
    const PATH = "/v1/position/assignments";

    it("rejects with no auth", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 3, method: "POST" })),
        "Unauthorized",
      );
    });

    it("rejects a user-role key (no editor/admin role)", async () => {
      await expectUnauthorized(
        await target.invoke(
          guardReq(PATH, { ip: 4, method: "POST", bearer: userKey.key }),
        ),
        "Unauthorized",
      );
    });

    it("authorizes an editor key (400 input validation is post-auth)", async () => {
      await expectAuthorized(
        await target.invoke(
          guardReq(PATH, { ip: 5, method: "POST", bearer: editorKey.key }),
        ),
      );
    });

    it("authorizes an admin key", async () => {
      await expectAuthorized(
        await target.invoke(
          guardReq(PATH, { ip: 6, method: "POST", bearer: adminKey.key }),
        ),
      );
    });
  });

  describe("admin GET /v1/api-key", () => {
    const PATH = "/v1/api-key";

    it("rejects an editor key", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 7, bearer: editorKey.key })),
        "Unauthorized",
      );
    });

    it("authorizes an admin key", async () => {
      await expectAuthorized(
        await target.invoke(guardReq(PATH, { ip: 8, bearer: adminKey.key })),
      );
    });
  });

  describe("nationAdmin GET /v1/mail/templates", () => {
    const PATH = "/v1/mail/templates";
    const MSG = "This action requires F3 Nation admin privileges";

    it("rejects with no auth, with the exact message", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 9 })),
        MSG,
      );
    });

    it("rejects an admin key — a DB role on org 1 is named 'Test Nation', not 'F3 Nation'", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 10, bearer: adminKey.key })),
        MSG,
      );
    });

    it("rejects an admin JWT — a DB-backed nation admin is unreachable under the seed", async () => {
      // test-seed.ts creates exactly one nation org, { id: 1, "Test Nation" },
      // and no "F3 Nation" org at all — while isNationAdminFromSession needs
      // orgId===1 AND name~"f3 nation" AND roleName==="admin". So no DB-backed
      // role can satisfy it under the seed. This pins that reality.
      const token = await signFixtureJwt({ sub: jwtUser.userId });
      await expectUnauthorized(
        await target.invoke(guardReq(PATH, { ip: 11, bearer: token })),
        MSG,
      );
    });

    it("authorizes a nation-admin cookie (orgName is controlled in the token)", async () => {
      const cookie = await sessionCookie({ roles: NATION_ADMIN_COOKIE });
      await expectAuthorized(
        await target.invoke(guardReq(PATH, { ip: 12, cookie })),
      );
    });
  });

  describe("rejects a forged signature even for a real user", () => {
    // Unlike the live-safe forged-signature test below (sub: 999999, a user
    // that can't exist), this signs for jwtUser — a real row. If signature
    // verification were ever skipped or short-circuited, getSessionFromJWT
    // would find this user and authorize the request, so this test actually
    // fails closed on that regression instead of passing for the unrelated
    // reason that the subject doesn't exist.
    it("rejects a JWT for a real user signed with a key the JWKS never published", async () => {
      const token = await signFixtureJwt({
        sub: jwtUser.userId,
        key: await generateForeignKey(),
      });
      await expectUnauthorized(
        await target.invoke(guardReq("/v1/api-key", { ip: 25, bearer: token })),
        "Unauthorized",
      );
    });
  });

  // #378: publicReadProcedure — anonymous reaches the map's browse endpoints,
  // but not the endpoints that stayed protectedProcedure/editorProcedure.
  describe("publicReadProcedure GET /v1/map/location/events-and-locations", () => {
    const PATH = "/v1/map/location/events-and-locations";

    it("authorizes a fully anonymous caller (no cookie, no bearer)", async () => {
      await expectAuthorized(await target.invoke(guardReq(PATH, { ip: 13 })));
    });
  });

  describe("still-protected endpoints reject an anonymous caller", () => {
    it("protected POST /v1/request/create-event-request", async () => {
      await expectUnauthorized(
        await target.invoke(
          guardReq("/v1/request/create-event-request", {
            ip: 14,
            method: "POST",
          }),
        ),
        "Unauthorized",
      );
    });

    it("protected GET /v1/attendance/event-instance/{id}", async () => {
      await expectUnauthorized(
        await target.invoke(
          guardReq("/v1/attendance/event-instance/1", { ip: 15 }),
        ),
        "Unauthorized",
      );
    });

    it("editor GET /v1/user/id/{id}", async () => {
      await expectUnauthorized(
        await target.invoke(guardReq("/v1/user/id/1", { ip: 16 })),
        "Unauthorized",
      );
    });

    it("a signed-in user's cookie still authorizes /v1/request/create-event-request", async () => {
      const cookie = await sessionCookie({ roles: [] });
      await expectAuthorized(
        await target.invoke(
          guardReq("/v1/request/create-event-request", {
            ip: 17,
            method: "POST",
            cookie,
          }),
        ),
      );
    });
  });
});
// Fixture-free subset of the guards above: no DB fixtures (createApiKey,
// createFixtureUser, sessionCookie all need the in-process DB/cookie-signing
// machinery), so unlike everything in the describe.runIf(target.inProcess)
// block above, this runs against ANY target including a live deployment
// (apps/api/characterization/targets/live.ts) — #876 Phase 3 names this
// live-mode auth coverage as a cutover prerequisite that didn't exist before
// (every other auth characterization test is gated to in-process only).
describe("role guards — live-safe (no fixtures, every target)", () => {
  it("protected GET rejects with no auth", async () => {
    await expectUnauthorized(
      await target.invoke(guardReq("/v1/position/assignments/all", { ip: 18 })),
      "Unauthorized",
    );
  });

  it("editor POST rejects with no auth", async () => {
    await expectUnauthorized(
      await target.invoke(
        guardReq("/v1/position/assignments", { ip: 19, method: "POST" }),
      ),
      "Unauthorized",
    );
  });

  it("admin GET rejects with no auth", async () => {
    await expectUnauthorized(
      await target.invoke(guardReq("/v1/api-key", { ip: 20 })),
      "Unauthorized",
    );
  });

  it("nationAdmin GET rejects with no auth, with the exact message", async () => {
    await expectUnauthorized(
      await target.invoke(guardReq("/v1/mail/templates", { ip: 21 })),
      "This action requires F3 Nation admin privileges",
    );
  });

  it("rejects a garbage bearer token (not a JWT, not a known API key)", async () => {
    await expectUnauthorized(
      await target.invoke(
        guardReq("/v1/api-key", { ip: 22, bearer: "not-a-real-credential" }),
      ),
      "Unauthorized",
    );
  });

  it("rejects a structurally-invalid JWT (garbage segments, not valid base64url JSON)", async () => {
    await expectUnauthorized(
      await target.invoke(guardReq("/v1/api-key", { ip: 23, bearer: "a.b.c" })),
      "Unauthorized",
    );
  });

  // Signed with a key the real deployment's JWKS never published under this
  // kid. Fixture-free, so `sub` can't be a real user — meaning this alone
  // can't tell "signature correctly rejected" apart from "signature wrongly
  // accepted, then correctly rejected for a nonexistent user." The
  // real-user variant above (in-process only) closes that gap; this one's
  // job is just to extend the same shape of coverage to a live deployment.
  it("rejects a JWT signed by a key the real JWKS never published", async () => {
    const token = await signFixtureJwt({
      sub: 999999,
      key: await generateForeignKey(),
    });
    await expectUnauthorized(
      await target.invoke(guardReq("/v1/api-key", { ip: 24, bearer: token })),
      "Unauthorized",
    );
  });
});
