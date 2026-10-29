import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

import { API_RESPONSE_TIMEOUT_MS, client, watchBody } from "~/orpc/client";

// Unlike the other oRPC tests, this runs the real browser link: it pins the
// contract that what oRPC throws during a real outage is what the classifier
// expects, including across oRPC upgrades and browsers.

const fetchMock = vi.fn<typeof fetch>();

async function regionsError(signal?: AbortSignal): Promise<unknown> {
  return client.map.location.regionsWithLocation(undefined, { signal }).then(
    () => {
      throw new Error("expected the request to reject");
    },
    (error: unknown) => error,
  );
}

describe("map oRPC client during an API outage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("classifies a failed connection as unavailable", async () => {
    // Chrome's wording; Firefox and Safari differ, which is why the link wraps it.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(isApiUnavailableError(await regionsError())).toBe(true);
  });

  it("classifies the proxy's 503 as unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response("The F3 Nation API is unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );

    expect(isApiUnavailableError(await regionsError())).toBe(true);
  });

  it("classifies a 502 with no content-type as unavailable", async () => {
    const response = new Response("<h1>Bad Gateway</h1>", { status: 502 });
    response.headers.delete("content-type");
    fetchMock.mockResolvedValue(response);

    expect(isApiUnavailableError(await regionsError())).toBe(true);
  });

  it("classifies a JSON 5xx oRPC error as unavailable", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          json: {
            defined: false,
            code: "INTERNAL_SERVER_ERROR",
            status: 500,
            message: "db down",
          },
        },
        { status: 500 },
      ),
    );

    expect(isApiUnavailableError(await regionsError())).toBe(true);
  });

  it("does not classify a 403 oRPC error as unavailable", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          json: {
            defined: false,
            code: "FORBIDDEN",
            status: 403,
            message: "Forbidden",
          },
        },
        { status: 403 },
      ),
    );

    expect(isApiUnavailableError(await regionsError())).toBe(false);
  });

  it("classifies an API that never answers as unavailable", async () => {
    vi.useFakeTimers();
    // Never settles on its own; only the client's own timeout ends it.
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );

    const pending = regionsError();
    await vi.advanceTimersByTimeAsync(API_RESPONSE_TIMEOUT_MS);

    expect(isApiUnavailableError(await pending)).toBe(true);
  });

  it("lets a slow body finish as long as it keeps arriving", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const parts = ['{"json":', "[]}"];
    // One chunk per pull, each just inside the timeout: slow overall, never idle.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) =>
          setTimeout(resolve, API_RESPONSE_TIMEOUT_MS - 1),
        );
        const part = parts.shift();
        if (part === undefined) controller.close();
        else controller.enqueue(encoder.encode(part));
      },
    });
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );

    const pending = client.map.location.regionsWithLocation();
    await vi.advanceTimersByTimeAsync(API_RESPONSE_TIMEOUT_MS * 3);

    await expect(pending).resolves.toEqual([]);
  });

  it("classifies a body that stops arriving as unavailable", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => {
      // Like a real fetch body: never sends data, errors once aborted.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "application/json" } }),
      );
    });

    const pending = regionsError();
    await vi.advanceTimersByTimeAsync(API_RESPONSE_TIMEOUT_MS);

    expect(isApiUnavailableError(await pending)).toBe(true);
  });

  it("does not time out a body while its reader is the one pausing", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // Like a real fetch body: fully downloaded, but errors if aborted first.
    const source = new ReadableStream<Uint8Array>({
      start(stream) {
        controller.signal.addEventListener("abort", () => {
          stream.error(controller.signal.reason);
        });
        stream.enqueue(new Uint8Array([1]));
        stream.enqueue(new Uint8Array([2]));
        stream.close();
      },
    });
    const reader = watchBody(
      source,
      controller,
      new AbortController().signal,
      () => undefined,
    ).getReader();

    await vi.advanceTimersByTimeAsync(API_RESPONSE_TIMEOUT_MS * 2);

    expect(controller.signal.aborted).toBe(false);
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    expect((await reader.read()).value).toEqual(new Uint8Array([2]));
    expect((await reader.read()).done).toBe(true);
  });

  it("classifies a connection dropped mid-body as unavailable", async () => {
    const body = new ReadableStream<Uint8Array>({
      // Chrome's wording for a body that fails after the headers arrived.
      pull: (controller) => controller.error(new TypeError("network error")),
    });
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );

    expect(isApiUnavailableError(await regionsError())).toBe(true);
  });

  it("stops forwarding the caller's abort once the body is read", async () => {
    let removed: MockInstance<AbortSignal["removeEventListener"]> | undefined;
    fetchMock.mockImplementation((input) => {
      removed = vi.spyOn((input as Request).signal, "removeEventListener");
      return Promise.resolve(Response.json({ json: [] }));
    });

    await client.map.location.regionsWithLocation();

    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("keeps the 503 when discarding the error page fails", async () => {
    const response = new Response("<h1>Bad Gateway</h1>", { status: 502 });
    response.headers.delete("content-type");
    vi.spyOn(response.body!, "cancel").mockRejectedValue(
      new TypeError("network error"),
    );
    fetchMock.mockResolvedValue(response);

    expect(await regionsError()).toMatchObject({ status: 502 });
  });

  it("does not report a cancelled query as an outage", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          // Like the real fetch: reject at once if already aborted.
          if (signal?.aborted) reject(signal.reason as Error);
          signal?.addEventListener("abort", () => {
            reject(signal.reason as Error);
          });
        }),
    );

    const pending = regionsError(controller.signal);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    controller.abort(new DOMException("unmounted", "AbortError"));
    const error = await pending;

    expect((error as Error).name).toBe("AbortError");
    expect(error).not.toMatchObject({ status: 503 });
  });
});
