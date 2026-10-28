import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/oauth", () => ({ validateAccessToken: vi.fn() }));
vi.mock("~/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 59 })),
}));
vi.mock("~/lib/better-auth-oauth", () => ({ forwardToBetterAuth: vi.fn() }));

const { validateAccessToken } = await import("~/lib/oauth");
const { rateLimit } = await import("~/lib/rate-limit");
const { forwardToBetterAuth } = await import("~/lib/better-auth-oauth");
const { GET } = await import("../../../../../src/app/api/oauth/userinfo/route");

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("https://auth.test.invalid/api/oauth/userinfo", {
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
});

describe("GET /api/oauth/userinfo", () => {
  it("serves the hand-rolled claims while the flag is off", async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      user: {
        id: 7,
        f3Name: "Tackle",
        avatarUrl: null,
        email: "t@f3nation.test",
        emailVerified: "2026-01-01",
      },
      scopes: "openid profile email",
    } as never);

    const res = await GET(makeRequest({ authorization: "Bearer at" }));

    expect(await res.json()).toEqual({
      sub: "7",
      name: "Tackle",
      picture: null,
      email: "t@f3nation.test",
      email_verified: true,
    });
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });

  it("rejects a request without a bearer token while the flag is off", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("rejects a non-Bearer authorization header while the flag is off", async () => {
    const res = await GET(makeRequest({ authorization: "Basic abc" }));
    expect(res.status).toBe(401);
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a token the hand-rolled server doesn't validate", async () => {
    vi.mocked(validateAccessToken).mockResolvedValue(null);
    const res = await GET(makeRequest({ authorization: "Bearer bad" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("returns only the claims the granted scopes allow, with a falsy email_verified as false", async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      user: {
        id: 7,
        f3Name: "Tackle",
        avatarUrl: "a.png",
        email: "t@f3nation.test",
        emailVerified: null,
      },
      scopes: "openid email",
    } as never);

    const res = await GET(makeRequest({ authorization: "Bearer at" }));

    expect(await res.json()).toEqual({
      sub: "7",
      email: "t@f3nation.test",
      email_verified: false,
    });
  });

  it("forwards to Better Auth, without cookies, while the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const response = Response.json({ sub: "7" });
    vi.mocked(forwardToBetterAuth).mockResolvedValue(response);
    const req = makeRequest({ authorization: "Bearer at" });

    await expect(GET(req)).resolves.toBe(response);

    expect(forwardToBetterAuth).toHaveBeenCalledWith(req, "userinfo", {
      dropCookies: true,
    });
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it("keeps the per-IP rate limit in front of Better Auth", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await GET(makeRequest({ authorization: "Bearer at" }));

    expect(res.status).toBe(429);
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });
});
