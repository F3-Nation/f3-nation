import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/app/api-availability";

import { API_RESPONSE_TIMEOUT_MS, client } from "~/orpc/client";

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

  it("does not time out a response whose headers arrived", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ start: () => undefined });
    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "application/json" },
      }),
    );

    const pending = regionsError();
    await vi.advanceTimersByTimeAsync(API_RESPONSE_TIMEOUT_MS * 2);

    // The body is still downloading (a slow connection), which is not an error.
    expect(vi.getTimerCount()).toBe(0);
    void pending;
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
