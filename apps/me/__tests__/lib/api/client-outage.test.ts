import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

// Unlike client.test.ts, this runs the real oRPC client: it pins the contract
// that what oRPC throws during a real outage is what the classifier expects,
// including across oRPC upgrades.

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

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
    // A bare load-balancer error page; without the guard in the RPCLink fetch
    // oRPC fails to parse it and the 502 status is lost.
    const response = new Response("<h1>Bad Gateway</h1>", { status: 502 });
    response.headers.delete("content-type");
    fetchMock.mockResolvedValue(response);

    expect(isApiUnavailableError(await profileError())).toBe(true);
  });

  it("times out an API that never answers", async () => {
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
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
            stream.error(new DOMException("aborted", "AbortError"));
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
    // A real oRPC 5xx is JSON, so it skips the guard and keeps its status.
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
});
