import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment variables
process.env.F3_API_BASE_URL = "https://api.test.f3nation.com";
process.env.F3_API_KEY = "test-api-key";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getUser sends correct headers and URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, f3Name: "Dredd" }),
    });

    // Dynamic import to pick up mocked env vars
    const { getUser } = await import("@/lib/api/client");
    const user = await getUser(42);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/user/id/42?includePii=true",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          Client: "f3-me",
        }),
      }),
    );
    expect(user.id).toBe(42);
    expect(user.f3Name).toBe("Dredd");
  });

  it("updateUser sends POST with body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, f3Name: "UpdatedName" }),
    });

    const { updateUser } = await import("@/lib/api/client");
    const result = await updateUser({ id: 42, f3Name: "UpdatedName" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/user",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: 42, f3Name: "UpdatedName" }),
      }),
    );
    expect(result.f3Name).toBe("UpdatedName");
  });

  it("getRegions calls correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, name: "Charlotte" }],
    });

    const { getRegions } = await import("@/lib/api/client");
    const regions = await getRegions();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/org?orgType=region&isActive=true",
      expect.objectContaining({
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

    const { getUser } = await import("@/lib/api/client");
    await expect(getUser(999)).rejects.toThrow("API error 404");
  });

  it("getPositionAssignments calls correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        orgId: 5,
        assignments: [{ positionId: 1, positionName: "Nantan", userIds: [42] }],
      }),
    });

    const { getPositionAssignments } = await import("@/lib/api/client");
    const result = await getPositionAssignments(5);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/position/assignments/5",
      expect.anything(),
    );
    expect(result.orgId).toBe(5);
    expect(result.assignments).toHaveLength(1);
  });

  it("updatePositionAssignments sends PUT with body", async () => {
    const updatedAssignments = [{ positionId: 1, userIds: [100, 200] }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orgId: 5, assignments: updatedAssignments }),
    });

    const { updatePositionAssignments } = await import("@/lib/api/client");
    await updatePositionAssignments(5, updatedAssignments);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test.f3nation.com/v1/position/assignments",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ orgId: 5, assignments: updatedAssignments }),
      }),
    );
  });
});
