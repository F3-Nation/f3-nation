import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/logging", () => ({ logWarn: vi.fn() }));
vi.mock("server-only", () => ({}));

import { isApiDown } from "~/lib/api-health";

describe("isApiDown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns false when base URL is not configured", async () => {
    expect(await isApiDown(undefined)).toBe(false);
  });

  it("returns false for a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    expect(await isApiDown("http://api.test")).toBe(false);
  });

  it("returns false for a 4xx response (e.g. 429 rate-limit)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 429 }));
    expect(await isApiDown("http://api.test")).toBe(false);
  });

  it("returns true for a 5xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    expect(await isApiDown("http://api.test")).toBe(true);
  });

  it("returns true and logs a warning when fetch throws", async () => {
    const { logWarn } = await import("~/lib/logging");
    const err = new Error("ECONNREFUSED");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));
    expect(await isApiDown("http://api.test")).toBe(true);
    expect(vi.mocked(logWarn)).toHaveBeenCalledWith(
      "map.api_health.check_failed",
      { err },
    );
  });

  it("fetches the /v1/ping path with a 30s revalidate window and a 3s timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await isApiDown("http://api.test/v1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/v1/ping",
      expect.objectContaining({ next: { revalidate: 30 } }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
  });
});
