import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

import { fetchRegions } from "@/lib/api";
import { logError, logWarn } from "@/lib/logging";

vi.mock("server-only", () => ({}));

vi.mock("@/env", () => ({
  env: { F3_API_BASE_URL: "https://api.test/v1", F3_CHANNEL: "local" },
}));

const mockLogging = vi.hoisted(() => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/logging", () => mockLogging);

const emptyRegionsResponse = () =>
  new Response(JSON.stringify({ json: [], meta: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("fetchRegions", () => {
  it("tags every upstream request with the region-pages client header", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(emptyRegionsResponse());

    await expect(fetchRegions()).resolves.toEqual([]);

    const request = vi.mocked(globalThis.fetch).mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).headers.get(Header.Client)).toBe(
      Client.F3_REGION_PAGES,
    );
  });

  it("logs a warning and rejects when upstream returns an HTTP error", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("", { status: 503 }),
    );

    await fetchRegions().catch(() => undefined);

    expect(logWarn).toHaveBeenCalledWith(
      "region_pages.api.upstream_http_error",
      expect.objectContaining({ status: 503 }),
    );
  });

  it("logs an error with the cause and rejects when the request fails", async () => {
    const networkError = new TypeError("fetch failed");
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(networkError);

    await expect(fetchRegions()).rejects.toThrow("fetch failed");

    expect(logError).toHaveBeenCalledWith(
      "region_pages.api.upstream_request_failed",
      expect.any(Object),
      networkError,
    );
  });
});
