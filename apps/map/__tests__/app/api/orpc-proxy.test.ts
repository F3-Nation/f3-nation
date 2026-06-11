import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
vi.stubEnv("F3_MAP_API_KEY", "test-map-key");

const fetchSpy = vi
  .fn<(url: URL, init: RequestInit) => Promise<Response>>()
  .mockResolvedValue(new Response("ok"));
vi.stubGlobal("fetch", fetchSpy);

describe("oRPC proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockClear();
  });

  it("forwards cookies to the upstream API", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/me", {
      headers: {
        cookie: "authjs.session-token=user-session-abc123",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.get("cookie")).toContain("authjs.session-token");
  });

  it("sets API key as Authorization fallback", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping");

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.get("authorization")).toBe("Bearer test-map-key");
  });

  it("strips host, content-length, and authorization but not cookie", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/me", {
      headers: {
        cookie: "authjs.session-token=abc",
        host: "localhost:3000",
        "content-length": "0",
        authorization: "Bearer crafted-token",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("host")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
    expect(headers.has("cookie")).toBe(true);
    expect(headers.get("authorization")).toBe("Bearer test-map-key");
  });

  it("proxies to the correct upstream URL", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/ping?foo=bar",
    );

    await GET(request);

    const url = fetchSpy.mock.calls[0]![0];

    expect(url.origin).toBe("http://localhost:3001");
    expect(url.pathname).toBe("/v1/ping");
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("forwards POST requests to upstream", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/map/location/workoutCount",
      { method: "POST", body: JSON.stringify({}) },
    );

    await POST(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]![0];
    expect(url.pathname).toBe("/v1/map/location/workoutCount");
  });

  it("drops crafted Authorization header when F3_MAP_API_KEY is unset", async () => {
    vi.stubEnv("F3_MAP_API_KEY", "");

    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping", {
      headers: {
        authorization: "Bearer crafted-token",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("authorization")).toBe(false);
  });
});
