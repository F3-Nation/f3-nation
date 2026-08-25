import { describe, expect, it, vi } from "vitest";

// Real ~/handler and ~/docs import @acme/api's router, which pulls in
// next-auth's ESM graph — broken under plain (non-characterization) vitest,
// same reason rest-route.test.ts and openapi-route.test.ts mock this too.
vi.mock("@acme/api", () => ({ router: {} }));
vi.mock("@orpc/server/fetch", () => ({
  RPCHandler: class RPCHandler {
    handle = vi.fn();
  },
}));
vi.mock("@orpc/openapi/fetch", () => ({
  OpenAPIHandler: class OpenAPIHandler {
    handle = vi.fn();
  },
}));
vi.mock("@orpc/openapi", () => ({
  OpenAPIGenerator: class OpenAPIGenerator {
    generate = vi.fn();
  },
}));

// apps/api/src/app/[[...rest]]/route.ts and app/docs/openapi.json/route.ts are
// no longer where the logic lives (moved to ~/handler and ~/docs for #649) —
// they're thin re-export shims that keep the currently-deployed Next entry
// working until phase 3+4 cuts over. Their own behavior is just "delegate";
// handler.ts/docs.ts's own tests cover the actual logic.
describe("Next route shims delegate to the moved modules", () => {
  it("[[...rest]]/route.ts re-exports handleRequest for every HTTP method", async () => {
    const { handleRequest } = await import("../src/handler");
    const route = await import("../src/app/[[...rest]]/route");

    expect(route.GET).toBe(handleRequest);
    expect(route.HEAD).toBe(handleRequest);
    expect(route.POST).toBe(handleRequest);
    expect(route.PUT).toBe(handleRequest);
    expect(route.PATCH).toBe(handleRequest);
    expect(route.DELETE).toBe(handleRequest);
    expect(route.OPTIONS).toBe(handleRequest);
  });

  it("docs/openapi.json/route.ts re-exports openApiJson as GET", async () => {
    const { openApiJson } = await import("../src/docs");
    const route = await import("../src/app/docs/openapi.json/route");

    expect(route.GET).toBe(openApiJson);
  });
});
