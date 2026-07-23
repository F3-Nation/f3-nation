import { describe, expect, it } from "vitest";

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
