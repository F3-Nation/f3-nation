import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

const logWarn = vi.hoisted(() => vi.fn());
vi.mock("~/lib/logging", () => ({ logWarn }));

vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");

const fetchSpy = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchSpy);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fetch that never answers, like an API that accepts and then hangs. */
function hangUntilAborted(_url: URL, init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

async function importRoute() {
  return import("../../../src/app/api/orpc/[[...rest]]/route");
}

function pingRequest() {
  return new NextRequest("http://localhost:3000/api/orpc/v1/ping");
}

describe("oRPC proxy when the API is down", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockReset();
    logWarn.mockClear();
    vi.stubEnv("F3_API_TIMEOUT_MS", "50");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
  });

  it("answers a refused connection with a 503 the map's client reads as an outage", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    const { GET } = await importRoute();

    const response = await GET(pingRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(logWarn).toHaveBeenCalledWith(
      "map.orpc_proxy.upstream_unavailable",
      expect.objectContaining({ path: "/v1/ping", timedOut: false }),
    );

    const client = createORPCClient<{ ping: () => Promise<unknown> }>(
      new RPCLink({
        url: "http://localhost:3000/api/orpc",
        fetch: () => Promise.resolve(response),
      }),
    );
    const error = await client.ping().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).status).toBe(503);
    expect(isApiUnavailableError(error)).toBe(true);
  });

  it("fails a missing F3_API_BASE_URL as a server error, not an outage", async () => {
    vi.stubEnv("F3_API_BASE_URL", "");
    const { GET } = await importRoute();

    await expect(GET(pingRequest())).rejects.toThrow(
      "F3_API_BASE_URL is required",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("times out an API that never answers instead of leaving the request pending", async () => {
    fetchSpy.mockImplementation(hangUntilAborted);
    const { GET } = await importRoute();

    const response = await GET(pingRequest());

    expect(response.status).toBe(503);
    expect(logWarn).toHaveBeenCalledWith(
      "map.orpc_proxy.upstream_unavailable",
      expect.objectContaining({ timedOut: true }),
    );
  });

  it("falls back to the default timeout when F3_API_TIMEOUT_MS is not a positive number", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "soon");
    vi.useFakeTimers();
    try {
      fetchSpy.mockImplementation(hangUntilAborted);
      const { GET, DEFAULT_UPSTREAM_TIMEOUT_MS } = await importRoute();

      const pending = GET(pingRequest());
      await vi.advanceTimersByTimeAsync(DEFAULT_UPSTREAM_TIMEOUT_MS - 1);
      expect(logWarn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails the body when the API sends headers and then goes quiet", async () => {
    fetchSpy.mockImplementation((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"json":'));
          // ...and nothing more until the request is aborted.
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const { GET } = await importRoute();

    const response = await GET(pingRequest());
    expect(response.status).toBe(200);

    await expect(response.text()).rejects.toThrow();
    expect(logWarn).toHaveBeenCalledWith(
      "map.orpc_proxy.upstream_body_failed",
      expect.objectContaining({ path: "/v1/ping" }),
    );
  });
});

describe("withStallTimeout", () => {
  it("doesn't count time spent waiting on a slow reader", async () => {
    const { withStallTimeout } = await importRoute();
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
    const { withStallTimeout } = await importRoute();
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
    const { withStallTimeout } = await importRoute();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });

    await withStallTimeout(source, 1_000, vi.fn()).cancel("gone");

    expect(cancel).toHaveBeenCalledWith("gone");
  });

  it("doesn't report a failure when the browser goes away mid-read", async () => {
    const { withStallTimeout } = await importRoute();
    // Never sends anything, so a read is still pending when the cancel lands.
    const source = new ReadableStream<Uint8Array>();
    const onFailure = vi.fn();
    const stream = withStallTimeout(source, 1_000, onFailure);
    const reader = stream.getReader();

    const pending = reader.read();
    await sleep(10); // let the pull start waiting on the API
    await reader.cancel("gone");

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await sleep(10);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
