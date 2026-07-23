import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKey } from "../fixtures/api-keys";
import { req, target } from "../transport";
import { expectAuthorized, expectUnauthorized } from "./verdict";

/**
 * API-key resolution edges. `/v1/api-key` is adminProcedure, so an admin key
 * that authorizes returns 200; `/v1/position/assignments` is editorProcedure.
 * Every request carries a Client header — a bearer without one is the separate
 * concern pinned in session.char.test.ts.
 */

const IP = (n: number) => `10.65.0.${n}`;

function keyReq(
  path: string,
  ip: number,
  key: string,
  opts: { prefix?: string; headerName?: string; method?: "GET" | "POST" } = {},
): Request {
  const headers: Record<string, string> = {
    "x-forwarded-for": IP(ip),
    [opts.headerName ?? "authorization"]: `${opts.prefix ?? "Bearer"} ${key}`,
    client: "characterization",
  };
  const method = opts.method ?? "GET";
  if (method === "POST") headers["content-type"] = "application/json";
  return req(path, {
    method,
    headers,
    ...(method === "POST" ? { body: "{}" } : {}),
  });
}

describe.runIf(target.inProcess)("API key resolution", () => {
  let adminKey: Awaited<ReturnType<typeof createApiKey>>;
  let noRoleKey: Awaited<ReturnType<typeof createApiKey>>;
  let expiredKey: Awaited<ReturnType<typeof createApiKey>>;

  beforeAll(async () => {
    adminKey = await createApiKey({ roles: [{ roleName: "admin" }] });
    noRoleKey = await createApiKey({ roles: [] });
    expiredKey = await createApiKey({
      roles: [{ roleName: "admin" }],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
  });

  afterAll(async () => {
    await adminKey.cleanup();
    await noRoleKey.cleanup();
    await expiredKey.cleanup();
  });

  it("rejects an expired key (compared against the DB clock)", async () => {
    await expectUnauthorized(
      await target.invoke(keyReq("/v1/api-key", 1, expiredKey.key)),
      "Unauthorized",
    );
  });

  it("rejects an unknown key on a protected endpoint", async () => {
    await expectUnauthorized(
      await target.invoke(keyReq("/v1/api-key", 2, "char-key-does-not-exist")),
      "Unauthorized",
    );
  });

  it("still serves a public procedure with an unknown key", async () => {
    const res = await target.invoke(
      keyReq("/v1/ping", 3, "char-key-does-not-exist"),
    );
    expect(res.status).toBe(200);
  });

  it("resolves an empty role list — editor procedure then 401s", async () => {
    await expectUnauthorized(
      await target.invoke(
        keyReq("/v1/position/assignments", 4, noRoleKey.key, {
          method: "POST",
        }),
      ),
      "Unauthorized",
    );
  });

  it("resolves an empty role list — admin procedure then 401s", async () => {
    await expectUnauthorized(
      await target.invoke(keyReq("/v1/api-key", 5, noRoleKey.key)),
      "Unauthorized",
    );
  });

  it("accepts a lowercase `authorization` header name", async () => {
    await expectAuthorized(
      await target.invoke(
        keyReq("/v1/api-key", 6, adminKey.key, { headerName: "authorization" }),
      ),
    );
  });

  it("accepts a lowercase `bearer` scheme prefix", async () => {
    await expectAuthorized(
      await target.invoke(
        keyReq("/v1/api-key", 7, adminKey.key, { prefix: "bearer" }),
      ),
    );
  });
});
