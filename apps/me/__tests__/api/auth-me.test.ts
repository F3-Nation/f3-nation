import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/server";

const mockSession = {
  sub: "42",
  email: "test@f3.com",
  userId: 42,
  iat: Date.now(),
};

describe("Auth /me route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns user when session exists", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(mockSession);

    const { GET } = await import("@/app/api/auth/me/route");
    const response = await GET();
    const data = (await response.json()) as {
      user: { sub: string; email: string; userId: number };
    };

    expect(response.status).toBe(200);
    expect(data.user.sub).toBe("42");
    expect(data.user.email).toBe("test@f3.com");
    expect(data.user.userId).toBe(42);
  });

  it("returns null user when no session exists", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const { GET } = await import("@/app/api/auth/me/route");
    const response = await GET();
    const data = (await response.json()) as { user: null };

    expect(response.status).toBe(200);
    expect(data.user).toBeNull();
  });

  it("returns user with name when present", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      ...mockSession,
      name: "Joe Dredd",
    });

    const { GET } = await import("@/app/api/auth/me/route");
    const response = await GET();
    const data = (await response.json()) as {
      user: { name: string };
    };

    expect(response.status).toBe(200);
    expect(data.user.name).toBe("Joe Dredd");
  });
});
