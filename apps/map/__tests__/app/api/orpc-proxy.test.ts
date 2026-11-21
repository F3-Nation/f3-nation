// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logWarn = vi.hoisted(() => vi.fn());
vi.mock("~/lib/logging", () => ({ logWarn }));

const fetchSpy = vi
  .fn<(url: URL, init: RequestInit) => Promise<Response>>()
  // A fresh Response per call: the proxy takes its own reader on every body,
  // which locks it, so a shared Response would fail on the next request.
  .mockImplementation(() => Promise.resolve(new Response("ok")));
vi.stubGlobal("fetch", fetchSpy);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("oRPC proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockClear();
    logWarn.mockClear();
    vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
    // CI exports a mock secret; each test sets the one it needs.
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("reports the browser's trusted hop to the API with the proxy secret", async () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", "s".repeat(32));
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping", {
      headers: {
        "x-forwarded-for": "9.9.9.9, 198.51.100.7",
        "x-f3-client-ip": "6.6.6.6",
        "x-f3-proxy-secret": "guess",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.get("x-f3-client-ip")).toBe("198.51.100.7");
    expect(headers.get("x-f3-proxy-secret")).toBe("s".repeat(32));
  });

  it("strips caller-sent proxy client-IP headers when no secret is configured", async () => {
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping", {
      headers: {
        "x-forwarded-for": "198.51.100.7",
        "x-f3-client-ip": "6.6.6.6",
        "x-f3-proxy-secret": "guess",
      },
    });

    await GET(request);

    const headers = fetchSpy.mock.calls[0]![1].headers as Headers;

    expect(headers.has("x-f3-client-ip")).toBe(false);
    expect(headers.has("x-f3-proxy-secret")).toBe(false);
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

  it("keeps a slow body that sends each chunk within the timeout", async () => {
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
      const text = response.text();
      // 60s in all, but never 20s without a chunk.
      for (const chunk of ["slow ", "but ", "whole"]) {
        await vi.advanceTimersByTimeAsync(19_999);
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();

      expect(response.status).toBe(200);
      expect(await text).toBe("slow but whole");
      expect(logWarn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the API request when the browser goes away mid-body, without logging a failure", async () => {
    let upstreamSignal: AbortSignal | undefined;
    fetchSpy.mockImplementationOnce((_url, init) => {
      upstreamSignal = init.signal ?? undefined;
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
    });
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/orpc/v1/ping"),
    );
    const reader = response.body!.getReader();
    const pending = reader.read();
    await sleep(10); // let the proxy start waiting on the API
    await reader.cancel("gone");

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(upstreamSignal?.aborted).toBe(true);
    await sleep(10);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("fails a body that stops arriving after the headers", async () => {
    vi.useFakeTimers();
    try {
      let upstreamSignal: AbortSignal | undefined;
      fetchSpy.mockImplementationOnce((_url, init) => {
        upstreamSignal = init.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"json":'));
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      });
      const { GET } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");

      const response = await GET(
        new NextRequest("http://localhost:3000/api/orpc/v1/ping"),
      );
      const text = response.text().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(response.status).toBe(200);
      expect(await text).toMatchObject({ name: "TimeoutError" });
      expect(upstreamSignal?.aborted).toBe(true);
      expect(logWarn).toHaveBeenCalledTimes(1);
      expect(logWarn.mock.lastCall).toMatchObject([
        "map.orpc_proxy.upstream_body_failed",
        { path: "/v1/ping", err: { name: "TimeoutError" } },
      ]);
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
    fetchSpy.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
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

    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
  });

  it("also sets Cache-Control: no-store on a public response", async () => {
    // Every path here forwards the caller's own cookie, including several
    // PUBLIC_PATHS entries whose response still varies per caller via
    // `onlyMine` for a signed-in editor -- a shared cache keyed on URL alone
    // can't tell that apart from the anonymous response for the same
    // path/query, so every response is uncached, not just SIGNED_IN_ONLY_PATHS.
    fetchSpy.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
    const { GET } = await import("../../../src/app/api/orpc/[[...rest]]/route");

    const request = new NextRequest("http://localhost:3000/api/orpc/v1/ping");

    const response = await GET(request);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  // fetch() decodes a compressed upstream body but keeps its headers; passing
  // them on would make the browser try to decode plain bytes again.
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

  // Next.js (16.4.5 and later) drops a route handler's Content-Encoding on the
  // way out, so the proxy must never encode a body itself.
  // Next.js's server compresses instead, unless Cache-Control says
  // no-transform.
  describe("compression", () => {
    const json = JSON.stringify({
      json: Array.from({ length: 500 }, (_, i) => [i, "AO name", null]),
    });
    const upstream = (
      contentType = "application/json",
      extra: Record<string, string> = {},
    ) =>
      fetchSpy.mockResolvedValueOnce(
        new Response(json, {
          headers: { "content-type": contentType, ...extra },
        }),
      );
    const call = async (path: string, acceptEncoding = "gzip, deflate, br") => {
      const { POST } =
        await import("../../../src/app/api/orpc/[[...rest]]/route");
      return POST(
        new NextRequest(`http://localhost:3000/api/orpc${path}`, {
          method: "POST",
          body: "{}",
          headers: { "accept-encoding": acceptEncoding },
        }),
      );
    };

    it("sends public JSON plain and leaves it compressible by Next.js", async () => {
      upstream();
      const res = await call("/v1/map/location/eventsAndLocations");
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(json);
    });

    it("sends a body fetch() already decoded plain, without its upstream encoding", async () => {
      upstream("application/json", { "content-encoding": "gzip" });
      const res = await call("/v1/map/location/eventsAndLocations");
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(await res.text()).toBe(json);
    });

    it("marks a signed-in-only response no-transform so it stays uncompressed", async () => {
      upstream();
      const res = await call("/v1/request/canEditRegions");
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
      expect(await res.text()).toBe(json);
    });

    it("marks non-JSON bodies (e.g. event streams) no-transform", async () => {
      upstream("text/event-stream");
      const res = await call("/v1/map/location/eventsAndLocations");
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
    });

    it("fails a body that stalls mid-body", async () => {
      vi.useFakeTimers();
      try {
        let upstreamSignal: AbortSignal | undefined;
        fetchSpy.mockImplementationOnce((_url, init) => {
          upstreamSignal = init.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"json":'));
            },
          });
          return Promise.resolve(
            new Response(body, {
              headers: { "content-type": "application/json" },
            }),
          );
        });
        const res = await call("/v1/map/location/eventsAndLocations");
        const read = res.arrayBuffer().catch((err: unknown) => err);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(await read).toMatchObject({ name: "TimeoutError" });
        expect(upstreamSignal?.aborted).toBe(true);
        expect(logWarn).toHaveBeenCalledWith(
          "map.orpc_proxy.upstream_body_failed",
          expect.objectContaining({
            path: "/v1/map/location/eventsAndLocations",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("aborts the API request when the browser leaves the body", async () => {
      let upstreamSignal: AbortSignal | undefined;
      fetchSpy.mockImplementationOnce((_url, init) => {
        upstreamSignal = init.signal ?? undefined;
        return Promise.resolve(
          new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "application/json" },
          }),
        );
      });
      const res = await call("/v1/map/location/eventsAndLocations");
      await res.body!.cancel("gone");
      await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true));
      expect(logWarn).not.toHaveBeenCalled();
    });
  });
});

describe("withStallTimeout", () => {
  async function importWithStallTimeout() {
    vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
    const { withStallTimeout } =
      await import("../../../src/app/api/orpc/[[...rest]]/route");
    return withStallTimeout;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("doesn't count time spent waiting on a slow reader", async () => {
    const withStallTimeout = await importWithStallTimeout();
    const chunks = ["a", "b", "c"].map((c) => new TextEncoder().encode(c));
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    const onFailure = vi.fn();

    const reader = withStallTimeout(source, 20, onFailure).getReader();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      await sleep(40);
    }

    expect(text).toBe("abc");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("passes on an upstream read error", async () => {
    const withStallTimeout = await importWithStallTimeout();
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const onFailure = vi.fn();

    const reader = withStallTimeout(source, 1_000, onFailure).getReader();

    await expect(reader.read()).rejects.toThrow("terminated");
    expect(onFailure).toHaveBeenCalledWith(new TypeError("terminated"));
  });

  it("cancels the upstream body when the browser goes away", async () => {
    const withStallTimeout = await importWithStallTimeout();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });

    await withStallTimeout(source, 1_000, vi.fn()).cancel("gone");

    expect(cancel).toHaveBeenCalledWith("gone");
  });

  it("doesn't report a failure when the browser goes away mid-read", async () => {
    const withStallTimeout = await importWithStallTimeout();
    // Never sends anything, so a read is still pending when the cancel lands.
    const source = new ReadableStream<Uint8Array>();
    const onFailure = vi.fn();
    const reader = withStallTimeout(source, 1_000, onFailure).getReader();

    const pending = reader.read();
    await sleep(10); // let the pull start waiting on the API
    await reader.cancel("gone");

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await sleep(10);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("doesn't report a failure when cancelling makes the pending read reject", async () => {
    const withStallTimeout = await importWithStallTimeout();
    let rejectRead!: (err: unknown) => void;
    const body = {
      getReader: () => ({
        read: () =>
          new Promise((_, reject) => {
            rejectRead = reject;
          }),
        cancel: () => {
          rejectRead(new TypeError("aborted"));
          return Promise.resolve();
        },
      }),
    } as unknown as ReadableStream<Uint8Array>;
    const onFailure = vi.fn();
    const reader = withStallTimeout(body, 60_000, onFailure).getReader();

    const pending = reader.read();
    await sleep(0);
    await reader.cancel("gone");

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await sleep(0);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("cancels the upstream body when it stalls", async () => {
    vi.useFakeTimers();
    try {
      const withStallTimeout = await importWithStallTimeout();
      const cancel = vi.fn();
      const source = new ReadableStream<Uint8Array>({ cancel });
      const onFailure = vi.fn();
      const read = withStallTimeout(source, 1_000, onFailure)
        .getReader()
        .read()
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await read).toMatchObject({ name: "TimeoutError" });
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TimeoutError" }),
      );
      expect(cancel).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TimeoutError" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a stalled tee branch without waiting for the other branch", async () => {
    vi.useFakeTimers();
    try {
      const withStallTimeout = await importWithStallTimeout();
      const [branch] = new ReadableStream<Uint8Array>().tee();
      const onFailure = vi.fn();
      const read = withStallTimeout(branch, 1_000, onFailure)
        .getReader()
        .read()
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(await read).toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles cancel on a tee branch without waiting for the other branch", async () => {
    const withStallTimeout = await importWithStallTimeout();
    const [branch] = new ReadableStream<Uint8Array>().tee();
    const onCancel = vi.fn();
    const cancelled = withStallTimeout(branch, 1_000, vi.fn(), onCancel).cancel(
      "gone",
    );

    await expect(
      Promise.race([cancelled.then(() => "settled"), sleep(50)]),
    ).resolves.toBe("settled");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("settles a browser cancel even when the upstream cancel rejects", async () => {
    const withStallTimeout = await importWithStallTimeout();
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        throw new TypeError("cancel failed");
      },
    });

    await expect(
      withStallTimeout(source, 1_000, vi.fn()).cancel("gone"),
    ).resolves.toBeUndefined();
  });

  it("reports the stall, not a rejected upstream cancel", async () => {
    vi.useFakeTimers();
    try {
      const withStallTimeout = await importWithStallTimeout();
      const source = new ReadableStream<Uint8Array>({
        cancel() {
          throw new TypeError("cancel failed");
        },
      });
      const onFailure = vi.fn();
      const read = withStallTimeout(source, 1_000, onFailure)
        .getReader()
        .read()
        .catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await read).toMatchObject({ name: "TimeoutError" });
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({ name: "TimeoutError" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer behind once a chunk arrives", async () => {
    vi.useFakeTimers();
    try {
      const withStallTimeout = await importWithStallTimeout();
      const chunks = ["a", "b", "c"].map((c) => new TextEncoder().encode(c));
      const source = new ReadableStream<Uint8Array>({
        pull(c) {
          const next = chunks.shift();
          if (next) c.enqueue(next);
          else c.close();
        },
      });
      expect(
        await new Response(withStallTimeout(source, 20_000, vi.fn())).text(),
      ).toBe("abc");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
