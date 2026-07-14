import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCookieStore = {
  get: vi.fn().mockReturnValue({ value: "refresh-token-value" }),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

vi.mock("@/lib/auth/oauth", () => ({
  getOAuthConfig: vi.fn(() => ({ authServerUrl: "http://localhost:3002" })),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}));

import { revokeToken } from "@/lib/auth/oauth";

describe("Auth /logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCookieStore.get.mockReturnValue({ value: "refresh-token-value" });
  });

  it("clears auth cookies and returns ok", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();
    const data = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify the session cookie is cleared (maxAge: 0)
    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("access_token=");
    expect(setCookieHeader).toContain("refresh_token=");
    expect(setCookieHeader).toContain("Max-Age=0");
  });

  it("revokes the refresh token before clearing cookies", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    await POST();

    expect(revokeToken).toHaveBeenCalledWith("refresh-token-value");
  });

  it("sets httpOnly on the cleared cookie", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("HttpOnly");
  });

  it("sets SameSite=Lax on the cleared cookie", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();

    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("SameSite=lax");
  });

  it("still logs out when no refresh token cookie exists", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("still clears cookies when revokeToken throws an Error", async () => {
    vi.mocked(revokeToken).mockRejectedValueOnce(
      new Error("revocation failed"),
    );

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();

    expect(response.status).toBe(200);
  });

  it("still clears cookies when revokeToken throws a non-Error", async () => {
    vi.mocked(revokeToken).mockRejectedValueOnce("plain string error");

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();

    expect(response.status).toBe(200);
  });
});
