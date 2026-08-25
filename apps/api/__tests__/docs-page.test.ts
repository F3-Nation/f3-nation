import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// docsPage is built once at module-eval time (Scalar's static-config form), so
// exercising both branches of getDocsBaseUrl needs a fresh module per env value.
describe("docsPage (Hono Scalar reference)", () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("renders the Scalar reference page when NEXT_PUBLIC_API_URL is set", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.f3nation.com";
    const { docsPage } = await import("../src/docs-page");
    const app = new Hono();
    app.get("/docs", docsPage);

    const res = await app.fetch(new Request("http://api.test/docs"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("F3 Nation API Reference");
  });

  it("still renders when NEXT_PUBLIC_API_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const { docsPage } = await import("../src/docs-page");
    const app = new Hono();
    app.get("/docs", docsPage);

    const res = await app.fetch(new Request("http://api.test/docs"));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("F3 Nation API Reference");
  });
});
