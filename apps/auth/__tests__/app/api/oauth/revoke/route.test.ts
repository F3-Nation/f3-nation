import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/oauth", () => ({ revokeToken: vi.fn() }));
vi.mock("~/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 29 })),
}));
vi.mock("~/lib/better-auth-oauth", () => ({ forwardToBetterAuth: vi.fn() }));

const { revokeToken } = await import("~/lib/oauth");
const { rateLimit } = await import("~/lib/rate-limit");
const { forwardToBetterAuth } = await import("~/lib/better-auth-oauth");
const { POST } = await import("../../../../../src/app/api/oauth/revoke/route");

function makeRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return new Request("https://auth.test.invalid/api/oauth/revoke", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
});

describe("POST /api/oauth/revoke", () => {
  it("revokes through the hand-rolled server while the flag is off", async () => {
    const res = await POST(makeRequest({ token: "rt" }));

    expect(await res.json()).toEqual({ revoked: true });
    expect(revokeToken).toHaveBeenCalledWith("rt");
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });

  it("returns 429 while the flag is off when rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ token: "rt" }));

    expect(res.status).toBe(429);
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the last x-forwarded-for entry", async () => {
    await POST(
      makeRequest({ token: "rt" }, { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }),
    );
    expect(rateLimit).toHaveBeenCalledWith("revoke:5.6.7.8", 30, 60000);
  });

  it("rejects a request with no token while the flag is off", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("forwards to Better Auth, without cookies, while the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const response = new Response(null, { status: 200 });
    vi.mocked(forwardToBetterAuth).mockResolvedValue(response);
    const req = makeRequest({ token: "rt", client_id: "c" });

    await expect(POST(req)).resolves.toBe(response);

    expect(forwardToBetterAuth).toHaveBeenCalledWith(req, "revoke", {
      dropCookies: true,
    });
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("keeps the per-IP rate limit in front of Better Auth", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ token: "rt" }));

    expect(res.status).toBe(429);
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });
});
