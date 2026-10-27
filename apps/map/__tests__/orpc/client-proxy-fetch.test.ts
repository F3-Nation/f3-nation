// @vitest-environment node
// Node's own DOMException/AbortController, so `instanceof DOMException` in
// the classifier and in proxyFetch sees the same realm as the errors thrown.
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

import { proxyFetch } from "~/orpc/client";

vi.mock("~/lib/logging", () => ({ logWarn: vi.fn() }));

vi.stubEnv("F3_API_BASE_URL", "http://localhost:3001");
vi.stubEnv("F3_API_TIMEOUT_MS", "50");

const API_ORIGIN = "http://localhost:3001";
const MAP_ORIGIN = "http://localhost:3000";

/** What the API does when it is asked for something. */
let upstream: (init: RequestInit) => Promise<Response>;

// One global fetch serves both hops: the browser calling the map's proxy, and
// the proxy calling the API.
const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith(API_ORIGIN)) return upstream(init ?? {});
  const { GET } = await import("../../src/app/api/orpc/[[...rest]]/route");
  return GET(new NextRequest(url, { signal: init?.signal ?? undefined }));
});
vi.stubGlobal("fetch", fetchSpy);

function pingClient() {
  return createORPCClient<{ ping: () => Promise<unknown> }>(
    new RPCLink({ url: `${MAP_ORIGIN}/api/orpc/v1`, fetch: proxyFetch }),
  );
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

describe("proxyFetch", () => {
  beforeEach(() => {
    fetchSpy.mockClear();
  });

  it("reads an API that stalls mid-body as an outage, end to end through the proxy", async () => {
    upstream = (init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"json":'));
              // ...and nothing more until the proxy gives up and aborts.
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const error = await pingClient()
      .ping()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).status).toBe(503);
    expect(isApiUnavailableError(error)).toBe(true);
  });

  it("passes a healthy response through unchanged", async () => {
    upstream = () => Promise.resolve(json({ json: "pong" }));

    await expect(pingClient().ping()).resolves.toBe("pong");
  });

  it("lets the caller's own abort through as an abort, not an outage", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new DOMException("aborted", "AbortError"));
            },
          }),
        ),
      ),
    );

    const error = await proxyFetch(
      new Request(`${MAP_ORIGIN}/api/orpc/v1/ping`),
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });
});
