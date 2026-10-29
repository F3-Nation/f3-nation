import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  getAccessToken: vi.fn(() => Promise.resolve("admin-access-token")),
}));

const fetchSpy = vi
  .fn<(url: URL, init: RequestInit) => Promise<Response>>()
  .mockResolvedValue(new Response("ok"));
vi.stubGlobal("fetch", fetchSpy);

const forwardedHeaders = () => fetchSpy.mock.calls[0]![1].headers as Headers;

describe("admin oRPC proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockClear();
    vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the browser's trusted hop to the API with the proxy secret", async () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", "s".repeat(32));
    const { GET } = await import("~/app/api/orpc/[[...rest]]/route");

    await GET(
      new NextRequest("http://localhost:3002/api/orpc/v1/ping", {
        headers: {
          "x-forwarded-for": "9.9.9.9, 198.51.100.7",
          "x-f3-client-ip": "6.6.6.6",
          "x-f3-proxy-secret": "guess",
        },
      }),
    );

    expect(forwardedHeaders().get("x-f3-client-ip")).toBe("198.51.100.7");
    expect(forwardedHeaders().get("x-f3-proxy-secret")).toBe("s".repeat(32));
    expect(forwardedHeaders().get("authorization")).toBe(
      "Bearer admin-access-token",
    );
  });

  it("strips caller-sent proxy client-IP headers when no secret is configured", async () => {
    const { GET } = await import("~/app/api/orpc/[[...rest]]/route");

    await GET(
      new NextRequest("http://localhost:3002/api/orpc/v1/ping", {
        headers: {
          "x-forwarded-for": "198.51.100.7",
          "x-f3-client-ip": "6.6.6.6",
          "x-f3-proxy-secret": "guess",
        },
      }),
    );

    expect(forwardedHeaders().has("x-f3-client-ip")).toBe(false);
    expect(forwardedHeaders().has("x-f3-proxy-secret")).toBe(false);
  });
});
