/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@acme/auth";
import { F3_NATION_ORG_ID } from "@acme/shared/app/constants";
import { POST } from "~/app/api/revalidate/route";

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("~/env", () => ({ env: { SUPER_ADMIN_API_KEY: "super-key" } }));
vi.mock("~/lib/logging", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const mockedAuth = auth as unknown as ReturnType<typeof vi.fn>;

const request = (headers: Record<string, string> = {}) =>
  new Request("https://map.example.test/api/revalidate", {
    method: "POST",
    headers,
  });

const nationAdmin = {
  roles: [{ orgId: F3_NATION_ORG_ID, orgName: "F3 Nation", roleName: "admin" }],
};

describe("POST /api/revalidate", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    mockedAuth.mockReset();
    revalidatePath.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revalidates and warms the page for the internal API key without a session", async () => {
    const res = await POST(request({ "x-api-key": "super-key" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, warmed: true });
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects a wrong API key with no session as 401", async () => {
    mockedAuth.mockResolvedValue(null);

    const res = await POST(request({ "x-api-key": "wrong-key" }));

    expect(res.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user who is not a nation admin as 403", async () => {
    mockedAuth.mockResolvedValue({
      roles: [{ orgId: 999, orgName: "F3 Boone", roleName: "admin" }],
    });

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates for a nation admin session", async () => {
    mockedAuth.mockResolvedValue(nationAdmin);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("still succeeds, reporting warmed: false, when the warm-up fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const res = await POST(request({ "x-api-key": "super-key" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, warmed: false });
  });

  it("reports warmed: false when the warm-up page answers non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));

    const res = await POST(request({ "x-api-key": "super-key" }));

    expect(await res.json()).toEqual({ success: true, warmed: false });
  });

  it("aborts a warm-up that never answers and still succeeds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );

      const pending = POST(request({ "x-api-key": "super-key" }));
      await vi.advanceTimersByTimeAsync(30_000);
      const res = await pending;

      expect(await res.json()).toEqual({ success: true, warmed: false });
      const signal = fetchMock.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 500 when revalidation throws", async () => {
    revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });

    const res = await POST(request({ "x-api-key": "super-key" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to revalidate cache" });
  });
});
