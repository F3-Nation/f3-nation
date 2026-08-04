import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue({ value: "refresh-token-value" }),
}));

const ssoMock = vi.hoisted(() => ({
  getOAuthConfig: vi.fn(() => ({
    authServerUrl: "https://auth.f3nation.test",
    clientId: "admin-client",
    redirectUri: "https://admin.f3nation.test/api/auth/callback",
  })),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

vi.mock("~/lib/auth/oauth", () => ({
  sso: ssoMock,
}));

describe("Auth /logout route (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.F3_ADMIN_BASE_URL = "https://admin.f3nation.test";
    mockCookieStore.get.mockReturnValue({ value: "refresh-token-value" });
  });

  describe("POST", () => {
    it("clears auth cookies and returns ok with redirectTo", async () => {
      const { POST } = await import("~/app/api/auth/logout/route");
      const response = await POST();
      const data = (await response.json()) as {
        ok: boolean;
        redirectTo: string;
      };

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.redirectTo).toContain("api/oauth/logout");
      expect(data.redirectTo).toContain(
        encodeURIComponent(
          "https://admin.f3nation.test/auth/sign-in?logged_out=true",
        ),
      );
    });

    it("revokes the refresh token", async () => {
      const { POST } = await import("~/app/api/auth/logout/route");
      await POST();

      expect(ssoMock.revokeToken).toHaveBeenCalledWith("refresh-token-value");
    });

    it("clears all four auth cookies with MaxAge=0", async () => {
      const { POST } = await import("~/app/api/auth/logout/route");
      const response = await POST();

      const setCookie = response.headers.getSetCookie();
      const cleared = setCookie.filter((c) => c.includes("Max-Age=0"));
      expect(cleared.length).toBeGreaterThanOrEqual(4);
    });

    it("still clears cookies when no refresh token cookie exists", async () => {
      mockCookieStore.get.mockReturnValue(undefined);

      const { POST } = await import("~/app/api/auth/logout/route");
      const response = await POST();

      expect(response.status).toBe(200);
      expect(ssoMock.revokeToken).not.toHaveBeenCalled();
    });

    it("still clears cookies when revokeToken throws", async () => {
      ssoMock.revokeToken.mockRejectedValueOnce(new Error("revoke failed"));

      const { POST } = await import("~/app/api/auth/logout/route");
      const response = await POST();
      const data = (await response.json()) as { ok: boolean };

      expect(data.ok).toBe(true);
    });

    it("uses F3_ADMIN_BASE_URL for the post-logout redirect URI", async () => {
      process.env.F3_ADMIN_BASE_URL = "https://custom.admin.test";

      const { POST } = await import("~/app/api/auth/logout/route");
      const response = await POST();
      const data = (await response.json()) as { redirectTo: string };

      expect(data.redirectTo).toContain(
        encodeURIComponent("https://custom.admin.test/auth/sign-in"),
      );
    });
  });

  describe("GET", () => {
    it("redirects to the auth-server logout URL for browser navigations", async () => {
      const { GET } = await import("~/app/api/auth/logout/route");
      const response = await GET();

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("api/oauth/logout");
    });
  });
});
