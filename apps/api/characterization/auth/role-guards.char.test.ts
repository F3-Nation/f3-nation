import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKey } from "../fixtures/api-keys";
import { sessionCookie } from "../fixtures/cookies";
import { signFixtureJwt } from "../fixtures/jwt";
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
});
