// @vitest-environment node
// Server code: under jsdom, Node's AbortController throws a DOMException from a
// different realm than the global one, which no real server would see.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

// Unlike client.test.ts, this runs the real oRPC client: it pins the contract
// that what oRPC throws during a real outage is what the classifier expects,
// including across oRPC upgrades.

const { cookiesMock, logError } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/logging", () => ({ logError, logWarn: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

async function profileError(): Promise<unknown> {
  const { getMyProfile } = await import("@/lib/api/client");
  return getMyProfile().then(
    () => {
      throw new Error("expected getMyProfile to reject");
    },
    (error: unknown) => error,
  );
}

describe("getMyProfile during an API outage", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    logError.mockReset();
    vi.stubEnv("F3_API_BASE_URL", "https://api.test.com");
    vi.stubGlobal("fetch", fetchMock);
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("classifies a refused connection as unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("classifies a 503 HTML page as unavailable", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Service Unavailable</html>", {
        status: 503,
        headers: { "content-type": "text/html" },
      }),
    );

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("classifies a 502 with no content-type as unavailable", async () => {
    // A bare load-balancer error page with no content-type still keeps its
    // 502 status.
    const response = new Response("<h1>Bad Gateway</h1>", { status: 502 });
    response.headers.delete("content-type");
    fetchMock.mockResolvedValue(response);

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("classifies a 5xx with malformed JSON as unavailable", async () => {
    // Labelled JSON but cut off (e.g. by a proxy); parsing it must not lose
    // the 5xx status.
    fetchMock.mockResolvedValue(
      new Response('{"json":{"code":', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("reports a proxy's HTML 500 as SERVICE_UNAVAILABLE, not the API's own 500", async () => {
    // Without the guard oRPC reports this as INTERNAL_SERVER_ERROR, the code
    // the API uses for its own failures, which the profile page logs as an
    // error.
    fetchMock.mockResolvedValue(
      new Response("<html>Internal Server Error</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    );

    expect(await profileError()).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 500,
    });
  });

  it("logs a non-JSON 5xx once, as a warning, not as a request failure", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Service Unavailable</html>", {
        status: 503,
        headers: { "content-type": "text/html" },
      }),
    );

    await profileError();
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs a refused connection as a request failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await profileError();
    expect(logError).toHaveBeenCalledWith(
      "me.api.upstream_request_failed",
      expect.anything(),
      expect.any(TypeError),
    );
  });

  it("times out an API that never answers", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          // Like fetch, reject with the signal's reason.
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("times out a body that stalls after the headers arrive", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal;
      // Headers arrive, then the body stalls until the request is aborted.
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"json":'));
          signal?.addEventListener("abort", () => {
            stream.error(signal.reason);
          });
        },
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("times out a stalled body that ignores the abort, as Next's copied body does", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    const cancel = vi.fn();
    fetchMock.mockImplementation(() => {
      // Next's patched fetch tees the response, so aborting the request never
      // errors this copy: it just stops sending.
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"json":'));
        },
        cancel,
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    expect(isApiUnavailableError(await profileError())).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  it("does not wait for a teed body's cancel to settle before timing out", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    fetchMock.mockImplementation(() => {
      const source = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"json":'));
        },
      });
      // Cancelling one branch of a tee settles only once the other branch is
      // cancelled too; nothing ever reads or cancels this one.
      const [body] = source.tee();
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    expect(isApiUnavailableError(await profileError())).toBe(true);
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

    expect(isApiUnavailableError(await profileError())).toBe(false);
  });

  it("classifies a JSON 5xx oRPC error as unavailable", async () => {
    // A real oRPC 5xx is JSON, so it passes the guard and keeps its status.
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

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("leaves no timer running after a fast response", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(Response.json({ json: { user: {} } }));
      const { getMyProfile } = await import("@/lib/api/client");

      await getMyProfile();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
