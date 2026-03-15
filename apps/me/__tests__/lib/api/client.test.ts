import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment variables
process.env.F3_API_BASE_URL = "https://api.test.f3nation.com/v1";
process.env.F3_API_KEY = "test-api-key";
process.env.SESSION_SECRET = "test-secret-that-is-long-enough-for-hmac";

// Mock server-only (no-op in tests)
vi.mock("server-only", () => ({}));

// Mock next/headers cookies()
const mockCookieStore = {
  get: vi.fn().mockReturnValue(undefined),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue(undefined);
  });

  it("getMyProfile sends correct headers and URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 42, f3Name: "Dredd" } }),
    });

    const { getMyProfile } = await import("@/lib/api/client");
    const user = await getMyProfile();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/me/profile",
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          Client: "f3-me",
        }),
      }),
    );
    expect(user.id).toBe(42);
    expect(user.f3Name).toBe("Dredd");
  });

  it("updateMyProfile sends PATCH with body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 42, f3Name: "UpdatedName" } }),
    });

    const { updateMyProfile } = await import("@/lib/api/client");
    const result = await updateMyProfile({ f3Name: "UpdatedName" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/me/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ f3Name: "UpdatedName" }),
      }),
    );
    expect(result.f3Name).toBe("UpdatedName");
  });

  it("getRegions calls correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        orgs: [{ id: 1, name: "Charlotte", orgType: "region", isActive: true }],
      }),
    });

    const { getRegions } = await import("@/lib/api/client");
    const regions = await getRegions();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/me/regions",
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({
          Client: "f3-me",
        }),
      }),
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].name).toBe("Charlotte");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });

    const { getMyProfile } = await import("@/lib/api/client");
    await expect(getMyProfile()).rejects.toThrow("API error 404");
  });

  it("deleteMyPosition sends DELETE with body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, found: true }),
    });

    const { deleteMyPosition } = await import("@/lib/api/client");
    const result = await deleteMyPosition(5, 10);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/me/positions",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ orgId: 5, positionId: 10 }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });

  it("deleteMyRole sends DELETE with body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, found: true }),
    });

    const { deleteMyRole } = await import("@/lib/api/client");
    const result = await deleteMyRole(1, 5);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/me/roles",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ orgId: 1, roleId: 5 }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });
});
