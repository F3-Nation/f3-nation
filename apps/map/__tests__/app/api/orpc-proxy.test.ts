import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");

const fetchSpy = vi
  .fn<(url: URL, init: RequestInit) => Promise<Response>>()
  .mockResolvedValue(new Response("ok"));
vi.stubGlobal("fetch", fetchSpy);

describe("oRPC proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockClear();
  });

  it("forwards cookies to the upstream API for a signed-in-only path", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/request/canEditRegions",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { cookie: "authjs.session-token=user-session-abc123" },
      },
    );

    await POST(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.get("cookie")).toContain("authjs.session-token");
  });

  it("forwards a public path with no Authorization header", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping");

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("authorization")).toBe(false);
  });

  it("does not attach any Authorization header on a signed-in-only path", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/request/canEditRegions",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { cookie: "authjs.session-token=abc" },
      },
    );

    await POST(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("authorization")).toBe(false);
  });

  it("strips a caller-forged Authorization header on a signed-in-only path, keeping only the cookie", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/request/canEditRegions",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          cookie: "authjs.session-token=abc",
          authorization: "Bearer crafted-token",
        },
      },
    );

    await POST(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("cookie")).toContain("authjs.session-token");
  });

  it.each([
    "/v1/map/location/getAOsInRegion",
    "/v1/event/all",
    "/v1/event/byId",
    "/v1/location/all",
    "/v1/org/all",
    "/v1/org/byId",
  ])(
    "forwards %s with no credential at all — publicReadProcedure needs none",
    async (path) => {
      const { POST } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      // No cookie, no bearer: these moved to the public read tier, so
      // an anonymous caller must still reach the upstream API, not get a 404.
      const request = new NextRequest(`http://localhost:3000/api/orpc${path}`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).not.toBe(404);
      const headers = fetchSpy.mock.calls[0]![1].headers as Headers;
      expect(headers.has("authorization")).toBe(false);
    },
  );

  it("rejects a path not on either allowlist without calling fetch, even with real credentials attached", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/user/byId",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          cookie: "authjs.session-token=abc",
          authorization: "Bearer crafted-token",
        },
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects another off-list path (attendance) without calling fetch", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/attendance/getForEventInstance",
      { method: "POST", body: JSON.stringify({}) },
    );

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["/v1/User/byId", "/v1/user/byId/", "/v1//user/byId"])(
    "rejects near-miss variant %s of an off-list path without calling fetch",
    async (path) => {
      const { POST } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      const request = new NextRequest(`http://localhost:3000/api/orpc${path}`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("still matches an allowlisted path exactly as written", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping");

    const response = await GET(request);

    expect(response.status).not.toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("strips host, content-length, crafted authorization, and crafted x-api-key on a public path", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping", {
      headers: {
        host: "localhost:3000",
        "content-length": "0",
        authorization: "Bearer crafted-token",
        "x-api-key": "attacker-key",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("host")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
  });

  it("answers 503 when the upstream API is unreachable", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/orpc/v1/map/location/regionsWithLocation",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Not JSON, so the client's outage guard (not oRPC's decoder) handles it.
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("answers 503 when the upstream API never responds", async () => {
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason as Error);
            });
          }),
      );
      const { GET } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      const pending = GET(
        new NextRequest(
          "http://localhost:3000/api/orpc/v1/map/location/regionsWithLocation",
        ),
      );
      // Still waiting just short of the bound, answered at it.
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a slow body once the headers have arrived", async () => {
    vi.useFakeTimers();
    try {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      fetchSpy.mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
      const { GET } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      const response = await GET(
        new NextRequest("http://localhost:3000/api/orpc/v1/ping"),
      );
      // The body only starts arriving after the header timeout has elapsed.
      await vi.advanceTimersByTimeAsync(60_000);
      controller.enqueue(new TextEncoder().encode("late but whole"));
      controller.close();

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("late but whole");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a missing F3_API_BASE_URL as an error, not as an outage", async () => {
    vi.stubEnv("F3_API_BASE_URL", "");
    try {
      const { GET } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      await expect(
        GET(new NextRequest("http://localhost:3000/api/orpc/v1/ping")),
      ).rejects.toThrow(/F3_API_BASE_URL/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
    }
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

  it("forwards POST requests to upstream for a public path", async () => {
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

  it("sets Cache-Control: no-store on a signed-in-only response", async () => {
    const { POST } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest(
      "http://localhost:3000/api/orpc/v1/request/canEditRegions",
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: { cookie: "authjs.session-token=abc" },
      },
    );

    const response = await POST(request);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("also sets Cache-Control: no-store on a public response", async () => {
    // Every path here forwards the caller's own cookie, including several
    // PUBLIC_PATHS entries whose response still varies per caller via
    // `onlyMine` for a signed-in editor -- a shared cache keyed on URL alone
    // can't tell that apart from the anonymous response for the same
    // path/query, so every response is uncached, not just SIGNED_IN_ONLY_PATHS.
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping");

    const response = await GET(request);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  // fetch() decodes a compressed upstream body but keeps its headers; passing
  // them on makes the browser try to decode plain bytes again. No
  // accept-encoding here, so the proxy passes the body through as is and the
  // upstream headers are the only way an encoding could appear.
  it.each(["/v1/ping", "/v1/request/canEditRegions"])(
    "drops upstream Content-Encoding and Content-Length on %s",
    async (path) => {
      fetchSpy.mockResolvedValueOnce(
        new Response('{"ok":true}', {
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            "content-length": "999",
          },
        }),
      );
      const { GET } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/orpc${path}`),
      );

      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("content-length")).not.toBe("999");
      expect(await response.json()).toEqual({ ok: true });
    },
  );

  it("gzips an upstream-gzipped body exactly once when the caller accepts gzip", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
      }),
    );
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orpc/v1/ping", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    const text = await new Response(
      response.body!.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  describe("compression", () => {
    const json = JSON.stringify({
      json: Array.from({ length: 500 }, (_, i) => [i, "AO name", null]),
    });
    const upstream = (contentType = "application/json") =>
      fetchSpy.mockResolvedValueOnce(
        new Response(json, { headers: { "content-type": contentType } }),
      );
    const call = async (acceptEncoding?: string) => {
      const { POST } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");
      return POST(
        new NextRequest(
          "http://localhost:3000/api/orpc/v1/map/location/eventsAndLocations",
          {
            method: "POST",
            body: "{}",
            headers: acceptEncoding
              ? { "accept-encoding": acceptEncoding }
              : {},
          },
        ),
      );
    };
    const gunzip = async (res: Response) =>
      new Response(
        res.body!.pipeThrough(new DecompressionStream("gzip")),
      ).text();

    it("gzips a JSON response when the caller accepts gzip", async () => {
      upstream();
      const res = await call("gzip, deflate, br");
      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(res.headers.get("vary")).toMatch(/accept-encoding/i);
      expect(await gunzip(res)).toBe(json);
    });

    it("never compresses a signed-in-only response", async () => {
      upstream();
      const { POST } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");
      const res = await POST(
        new NextRequest(
          "http://localhost:3000/api/orpc/v1/request/canEditRegions",
          {
            method: "POST",
            body: "{}",
            headers: { "accept-encoding": "gzip" },
          },
        ),
      );
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(await res.text()).toBe(json);
    });

    it("passes the body through when the caller doesn't accept gzip", async () => {
      upstream();
      const res = await call();
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(await res.text()).toBe(json);
    });

    it("honors an explicit gzip;q=0, even with a wildcard", async () => {
      upstream();
      const res = await call("gzip;q=0, br");
      expect(res.headers.get("content-encoding")).toBeNull();
      upstream();
      const wild = await call("gzip;q=0, *;q=1");
      expect(wild.headers.get("content-encoding")).toBeNull();
    });

    it("accepts gzip through a wildcard when gzip isn't listed", async () => {
      upstream();
      const res = await call("br;q=1, *;q=0.5");
      expect(res.headers.get("content-encoding")).toBe("gzip");
    });

    it("leaves non-JSON bodies (e.g. event streams) uncompressed", async () => {
      upstream("text/event-stream");
      const res = await call("gzip");
      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });
});
