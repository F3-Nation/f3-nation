import { describe, expect, it } from "vitest";

describe("docs route", () => {
  it("returns the Scalar API reference page", async () => {
    const { GET } = await import("../src/app/docs/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("F3 Nation API Reference");
  });
});
