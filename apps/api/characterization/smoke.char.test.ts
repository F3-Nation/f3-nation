import { describe, expect, it, onTestFinished } from "vitest";

import { createApiKey } from "./fixtures/api-keys";
import { sessionCookie } from "./fixtures/cookies";
import { generateForeignKey, signFixtureJwt } from "./fixtures/jwt";
import { createFixtureUser } from "./fixtures/users";
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

// `/v1/api-key` is an adminProcedure, so a 200 proves the admin role actually
// reached the handler — a fixture that silently produced zero roles would 401.
describe.runIf(target.inProcess)("fixtures round-trip", () => {
  it("authenticates an admin endpoint with a fixture cookie", async () => {
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: { cookie, "x-forwarded-for": "10.60.0.1" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects the admin endpoint for a cookie with no roles", async () => {
    const cookie = await sessionCookie({ roles: [] });
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: { cookie, "x-forwarded-for": "10.60.0.5" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects the admin endpoint for an expired fixture cookie", async () => {
    // -60 clears @auth/core's 15s clockTolerance (see cookies.ts).
    const cookie = await sessionCookie({
      maxAge: -60,
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: { cookie, "x-forwarded-for": "10.60.0.6" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("authenticates an admin endpoint with a fixture API key", async () => {
    const apiKey = await createApiKey({ roles: [{ roleName: "admin" }] });
    onTestFinished(() => apiKey.cleanup());
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: {
          "x-forwarded-for": "10.60.0.2",
          authorization: `Bearer ${apiKey.key}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a revoked fixture API key", async () => {
    const apiKey = await createApiKey({
      revoked: true,
      roles: [{ roleName: "admin" }],
    });
    onTestFinished(() => apiKey.cleanup());
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: {
          "x-forwarded-for": "10.60.0.7",
          authorization: `Bearer ${apiKey.key}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  // Also the only proof that global-setup's JWKS server is reachable and
  // serving the key that shared.ts's createRemoteJWKSet fetches.
  it("authenticates with an RS256 JWT verified through the fixture JWKS", async () => {
    const user = await createFixtureUser({ roles: [{ roleName: "admin" }] });
    onTestFinished(() => user.cleanup());
    const token = await signFixtureJwt({ sub: user.userId });
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: {
          "x-forwarded-for": "10.60.0.3",
          authorization: `Bearer ${token}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a JWT signed by a key the JWKS does not publish", async () => {
    const user = await createFixtureUser({ roles: [{ roleName: "admin" }] });
    onTestFinished(() => user.cleanup());
    const token = await signFixtureJwt({
      sub: user.userId,
      key: await generateForeignKey(),
    });
    const res = await target.invoke(
      req("/v1/api-key", {
        headers: {
          "x-forwarded-for": "10.60.0.4",
          authorization: `Bearer ${token}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(401);
  });
});
