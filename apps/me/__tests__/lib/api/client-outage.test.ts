import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isApiUnavailableError } from "@acme/shared/app/api-availability";

// Unlike client.test.ts, this runs the real oRPC client: it pins the contract
// that what oRPC throws during a real outage is what the classifier expects,
// including across oRPC upgrades.

vi.mock("server-only", () => ({}));

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/logging", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

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
    vi.stubEnv("F3_API_BASE_URL", "https://api.test.com/v1");
    vi.stubGlobal("fetch", fetchMock);
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("classifies an API that never answers as unavailable", async () => {
    vi.useFakeTimers();
    vi.stubEnv("F3_API_TIMEOUT_MS", "20");
    // Never settles on its own; only the client's own timeout ends it.
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            reject(signal.reason as Error);
          });
        }),
    );

    const pending = profileError();
    await vi.advanceTimersByTimeAsync(20);
    const error = await pending;

    // The client's own timeout carries a TimeoutError reason, so it can be told
    // apart from the caller cancelling the request.
    expect((error as Error).name).toBe("TimeoutError");
    expect(isApiUnavailableError(error)).toBe(true);
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
