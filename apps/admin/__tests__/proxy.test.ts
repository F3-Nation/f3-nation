import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "~/lib/auth/constants";

const {
  verifyAccessTokenMock,
  refreshTokenMock,
  logDebugMock,
  logWarnMock,
  AuthError,
} = vi.hoisted(() => {
  // Minimal AuthError matching the real class so instanceof checks in the proxy work.
  class AuthError extends Error {
    code: string;
    statusCode?: number;
    constructor(message: string, code: string, statusCode?: number) {
      super(message);
      this.name = "AuthError";
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return {
    verifyAccessTokenMock: vi.fn(),
    refreshTokenMock: vi.fn(),
    logDebugMock: vi.fn(),
    logWarnMock: vi.fn(),
    AuthError,
  };
});

vi.mock("@f3nation/sso-next", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  verifyAccessToken: verifyAccessTokenMock,
  AuthError,
}));

vi.mock("~/lib/auth/oauth", () => ({ refreshToken: refreshTokenMock }));

vi.mock("~/env", () => ({
  env: {
    AUTH_PROVIDER_URL: "https://auth.test.com",
    OAUTH_CLIENT_ID: "admin-client",
  },
}));

vi.mock("~/lib/logging", () => ({
  logDebug: logDebugMock,
  logWarn: logWarnMock,
}));

// Import after mocks are registered (vi.mock is hoisted above imports).
const { proxy } = await import("~/proxy");

function makeRequest(
  path: string,
  opts: {
    accessToken?: string;
    refreshToken?: string;
    secFetchMode?: string;
  } = {},
) {
  const cookieParts: string[] = [];
  if (opts.accessToken)
    cookieParts.push(`${ACCESS_TOKEN_COOKIE_NAME}=${opts.accessToken}`);
  if (opts.refreshToken)
    cookieParts.push(`${REFRESH_TOKEN_COOKIE_NAME}=${opts.refreshToken}`);

  return new NextRequest(`https://app.test${path}`, {
    headers: {
      ...(cookieParts.length ? { cookie: cookieParts.join("; ") } : {}),
      ...(opts.secFetchMode ? { "sec-fetch-mode": opts.secFetchMode } : {}),
    },
  });
}

describe("proxy middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without clearing cookies when refresh fails on a non-navigation API request", async () => {
    verifyAccessTokenMock.mockResolvedValue({ ok: false, code: "expired" });
    refreshTokenMock.mockRejectedValue(new Error("refresh failed"));

    const response = await proxy(
      makeRequest("/api/data", {
        accessToken: "expired-tok",
        refreshToken: "refresh-tok",
        secFetchMode: "cors",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    // Cookies must not be cleared on a non-navigation failure (#375)
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("passes through without clearing cookies when the JWKS endpoint is unavailable", async () => {
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "jwks_unavailable",
      error: "Unable to reach JWKS endpoint",
    });

    const response = await proxy(
      makeRequest("/dashboard", {
        accessToken: "valid-tok",
        secFetchMode: "navigate",
      }),
    );

    // Request should proceed — do not destroy the session
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    // Refresh should not have been attempted
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it("logs debug (not warn) for an invalid_grant rotation loss on a non-navigation request", async () => {
    verifyAccessTokenMock.mockResolvedValue({ ok: false, code: "expired" });
    refreshTokenMock.mockRejectedValue(
      new AuthError("invalid_grant", "invalid_grant", 400),
    );

    await proxy(
      makeRequest("/some-page", {
        accessToken: "expired-tok",
        refreshToken: "stale-tok",
        secFetchMode: "cors",
      }),
    );

    expect(logDebugMock).toHaveBeenCalledWith(
      "admin.auth.refresh_invalid_grant",
      { isNavigationRequest: false },
    );
    expect(logWarnMock).not.toHaveBeenCalledWith(
      "admin.auth.refresh_failed",
      expect.anything(),
    );
  });

  it("returns 401 without clearing cookies when the refreshed token fails verification", async () => {
    // Initial token: expired
    verifyAccessTokenMock.mockResolvedValueOnce({ ok: false, code: "expired" });
    // Refresh call succeeds
    refreshTokenMock.mockResolvedValue({ accessToken: "refreshed-bad-tok" });
    // Refreshed token: fails verification (e.g. bad signature)
    verifyAccessTokenMock.mockResolvedValueOnce({
      ok: false,
      code: "invalid_signature",
      error: "Signature verification failed",
    });

    const response = await proxy(
      makeRequest("/api/data", {
        accessToken: "expired-tok",
        refreshToken: "refresh-tok",
        secFetchMode: "cors",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    // Cookies must not be cleared on a non-navigation failure
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
