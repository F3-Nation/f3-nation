import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as ReactModule from "react";

// Mock environment variables
process.env.F3_API_BASE_URL = "https://api.test.f3nation.com/v1";

// Mock server-only (no-op in tests)
vi.mock("server-only", () => ({}));

// Mock next/headers cookies()
const mockCookieStore = {
  get: vi
    .fn()
    .mockImplementation((name: string) =>
      name === "access_token" ? { value: "jwt-access-token" } : undefined,
    ),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

// ---------------------------------------------------------------------------
// Mock the oRPC client so tests don't hit the network
// ---------------------------------------------------------------------------
const mockMe = {
  profile: vi.fn(),
  updateProfile: vi.fn(),
  regions: vi.fn(),
  deletePosition: vi.fn(),
  deleteRole: vi.fn(),
  users: vi.fn(),
};

vi.mock("@orpc/client", () => ({
  createORPCClient: vi.fn(() => ({ me: mockMe })),
}));
vi.mock("@orpc/client/fetch", () => ({
  RPCLink: vi.fn(),
}));
// react's cache() is a no-op in test context; ensure fresh calls work
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, cache: (fn: unknown) => fn };
});

describe("API client (oRPC)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockImplementation((name: string) =>
      name === "access_token" ? { value: "jwt-access-token" } : undefined,
    );
  });

  it("getMyProfile returns the user from me.profile()", async () => {
    const fakeUser = { id: 42, f3Name: "Dredd", roles: [], positions: [] };
    mockMe.profile.mockResolvedValueOnce({ user: fakeUser });

    const { getMyProfile } = await import("@/lib/api/client");
    const user = await getMyProfile();

    expect(mockMe.profile).toHaveBeenCalledOnce();
    expect(user.id).toBe(42);
    expect(user.f3Name).toBe("Dredd");
  });

  it("updateMyProfile calls me.updateProfile() with the correct body", async () => {
    const fakeUser = {
      id: 42,
      f3Name: "UpdatedName",
      roles: [],
      positions: [],
    };
    mockMe.updateProfile.mockResolvedValueOnce({ user: fakeUser });

    const { updateMyProfile } = await import("@/lib/api/client");
    const result = await updateMyProfile({ f3Name: "UpdatedName" });

    expect(mockMe.updateProfile).toHaveBeenCalledWith({
      f3Name: "UpdatedName",
    });
    expect(result.f3Name).toBe("UpdatedName");
  });

  it("getRegions returns orgs from me.regions()", async () => {
    mockMe.regions.mockResolvedValueOnce({
      orgs: [{ id: 1, name: "Charlotte", isActive: true }],
    });

    const { getRegions } = await import("@/lib/api/client");
    const regions = await getRegions();

    expect(mockMe.regions).toHaveBeenCalledOnce();
    expect(regions).toHaveLength(1);
    expect(regions[0]?.name).toBe("Charlotte");
  });

  it("throws when the access token cookie is missing", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const { getMyProfile } = await import("@/lib/api/client");
    await expect(getMyProfile()).rejects.toThrow("Missing access token");
  });

  it("deleteMyPosition calls me.deletePosition() with orgId and positionId", async () => {
    mockMe.deletePosition.mockResolvedValueOnce({ success: true, found: true });

    const { deleteMyPosition } = await import("@/lib/api/client");
    const result = await deleteMyPosition(5, 10);

    expect(mockMe.deletePosition).toHaveBeenCalledWith({
      orgId: 5,
      positionId: 10,
    });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });

  it("deleteMyRole calls me.deleteRole() with orgId and roleId", async () => {
    mockMe.deleteRole.mockResolvedValueOnce({ success: true, found: true });

    const { deleteMyRole } = await import("@/lib/api/client");
    const result = await deleteMyRole(1, 5);

    expect(mockMe.deleteRole).toHaveBeenCalledWith({ orgId: 1, roleId: 5 });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
  });

  it("getUsers passes searchTerm when provided", async () => {
    mockMe.users.mockResolvedValueOnce({ users: [{ id: 7, f3Name: "Pax" }] });

    const { getUsers } = await import("@/lib/api/client");
    const users = await getUsers({ searchTerm: "pax" });

    expect(mockMe.users).toHaveBeenCalledWith({ searchTerm: "pax" });
    expect(users[0]?.f3Name).toBe("Pax");
  });

  it("getUsers passes userId when provided", async () => {
    mockMe.users.mockResolvedValueOnce({
      users: [{ id: 42, f3Name: "Dredd" }],
    });

    const { getUsers } = await import("@/lib/api/client");
    const users = await getUsers({ userId: 42 });

    expect(mockMe.users).toHaveBeenCalledWith({ userId: 42 });
    expect(users[0]?.id).toBe(42);
  });

  it("getUsers passes undefined when homeRegionId is not provided", async () => {
    mockMe.users.mockResolvedValueOnce({ users: [] });

    const { getUsers } = await import("@/lib/api/client");
    await getUsers();

    expect(mockMe.users).toHaveBeenCalledWith(undefined);
  });

  it("isNotFoundApiError returns true for code-based NOT_FOUND errors", async () => {
    const { isNotFoundApiError } = await import("`@/lib/api/client`");
    expect(isNotFoundApiError({ code: "NOT_FOUND" })).toBe(true);
  });

  it("isNotFoundApiError returns true for status-based 404 errors", async () => {
    const { isNotFoundApiError } = await import("`@/lib/api/client`");
    expect(isNotFoundApiError({ status: 404 })).toBe(true);
  });

  it("isNotFoundApiError returns false for non-api-like errors", async () => {
    const { isNotFoundApiError } = await import("`@/lib/api/client`");
    expect(isNotFoundApiError("not-an-object")).toBe(false);
  });

  it("isNotFoundApiError returns false for api-like errors that are not 404", async () => {
    const { isNotFoundApiError } = await import("`@/lib/api/client`");
    expect(isNotFoundApiError({ code: "BAD_REQUEST", status: 400 })).toBe(false);
  });
});
