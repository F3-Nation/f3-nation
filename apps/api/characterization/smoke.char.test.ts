import { describe, expect, it } from "vitest";

import { createApiKey } from "./fixtures/api-keys";
import { sessionCookie } from "./fixtures/cookies";
import { req, target } from "./transport";

describe("transport seam", () => {
  it("serves a public procedure through the seam", async () => {
    const res = await target.invoke(req("/v1/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alive: true });
  });

  it("serves the docs page unauthenticated", async () => {
    const res = await target.invoke(req("/docs"));
    expect(res.status).toBe(200);
  });

  it("serves the OpenAPI document unauthenticated", async () => {
    const res = await target.invoke(req("/docs/openapi.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns the exact 404 body for an unknown path", async () => {
    const res = await target.invoke(req("/definitely-not-a-route"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

describe.runIf(target.kind !== "live")("fixtures round-trip", () => {
  it("authenticates a protected procedure with a fixture cookie", async () => {
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await target.invoke(
      req("/v1/position/", {
        headers: { cookie, "x-forwarded-for": "10.60.0.1" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("authenticates a protected procedure with a fixture API key", async () => {
    const apiKey = await createApiKey({ roles: [{ roleName: "admin" }] });
    try {
      const res = await target.invoke(
        req("/v1/position/", {
          headers: {
            "x-forwarded-for": "10.60.0.2",
            authorization: `Bearer ${apiKey.key}`,
            client: "characterization",
          },
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      await apiKey.cleanup();
    }
  });
});
