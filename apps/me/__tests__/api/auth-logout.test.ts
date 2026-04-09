import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Auth /logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // The logout route imports getOAuthConfig which requires these env vars
    vi.stubEnv("OAUTH_CLIENT_ID", "test-client-id");
    vi.stubEnv("OAUTH_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("OAUTH_REDIRECT_URI", "http://localhost:3003/api/auth/callback");
    vi.stubEnv("AUTH_PROVIDER_URL", "http://localhost:3002");
  });

  it("clears session cookie and returns ok", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST();
    const data = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify the session cookie is cleared (maxAge: 0)
    const setCookieHeader = response.headers.get("set-cookie");
    expect(setCookieHeader).toContain("__session=");
    expect(setCookieHeader).toContain("Max-Age=0");
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
});
