import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  verifyAccessTokenMock,
  logDebugMock,
  logWarnMock,
  getMyProfileMock,
  redirectMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  verifyAccessTokenMock: vi.fn(),
  logDebugMock: vi.fn(),
  logWarnMock: vi.fn(),
  getMyProfileMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@f3nation/sso", async () => {
  const actual = await vi.importActual("@f3nation/sso");
  return { ...actual, verifyAccessToken: verifyAccessTokenMock };
});

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

vi.mock("~/lib/api/client", () => ({
  getMyProfile: getMyProfileMock,
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const validPayload = {
  ok: true as const,
  payload: { sub: "42", email: "admin@f3nation.test", name: "Site F" },
};

const adminRoles = [
  {
    roleId: 1,
    orgId: 10,
    orgName: "F3 Nation",
    roleName: "admin",
  },
];

describe("admin auth server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // getSessionUser
  // -------------------------------------------------------------------------

  it("returns null when access token cookie is missing", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns null and logs debug when token is expired", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "expired-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "expired",
      error: "Token expired",
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(logDebugMock).toHaveBeenCalledWith(
      "admin.auth.session_token_expired",
      {},
    );
  });

  it("returns null and logs warn when token verification fails (non-expired)", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "bad-sig-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "invalid_signature",
      error: "Bad signature",
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith(
      "admin.auth.session_verify_failed",
      { code: "invalid_signature", message: "Bad signature" },
    );
  });

  it("returns null and logs warn when payload is missing sub", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "no-sub-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { email: "admin@f3nation.test" },
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith(
      "admin.auth.session_claims_invalid",
      { reason: "missing_sub" },
    );
  });

  it("returns null and logs warn when payload is missing email", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "no-email-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "42" },
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith(
      "admin.auth.session_claims_invalid",
      { reason: "missing_email" },
    );
  });

  it("returns null when sub is not a positive integer", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "zero-sub-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "0", email: "admin@f3nation.test" },
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith(
      "admin.auth.session_claims_invalid",
      { reason: "non_integer_sub" },
    );
  });

  it("returns null when sub is a float", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "float-sub-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "1.5", email: "admin@f3nation.test" },
    });

    const { getSessionUser } = await import("~/lib/auth/server");
    expect(await getSessionUser()).toBeNull();
  });

  it("returns session with roles when valid token and profile exist", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue(validPayload);
    getMyProfileMock.mockResolvedValue({ roles: adminRoles });

    const { getSessionUser } = await import("~/lib/auth/server");
    const user = await getSessionUser();

    expect(verifyAccessTokenMock).toHaveBeenCalledWith(
      "valid-token",
      "https://auth.test.com",
      "admin-client",
      true,
    );
    expect(user).toMatchObject({
      sub: "42",
      id: 42,
      email: "admin@f3nation.test",
      roles: [{ roleName: "admin" }],
    });
  });

  it("returns session without roles when getMyProfile throws", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue(validPayload);
    getMyProfileMock.mockRejectedValue(new Error("API down"));

    const { getSessionUser } = await import("~/lib/auth/server");
    const user = await getSessionUser();

    expect(user).not.toBeNull();
    expect(user?.roles).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // requireAdminPortalAccess
  // -------------------------------------------------------------------------

  it("redirects to /api/auth/login when no access token", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });

    const { requireAdminPortalAccess } = await import("~/lib/auth/server");

    await expect(requireAdminPortalAccess()).rejects.toThrow(
      "redirect:/api/auth/login",
    );
  });

  it("redirects to no-access page when token is invalid (has cookie but bad claims)", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "bad-claims-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "0", email: "admin@f3nation.test" },
    });

    const { requireAdminPortalAccess } = await import("~/lib/auth/server");

    await expect(requireAdminPortalAccess()).rejects.toThrow(
      "reason=invalid-session",
    );
  });

  it("redirects to no-access page when user has no admin/editor roles", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue(validPayload);
    getMyProfileMock.mockResolvedValue({
      roles: [{ roleId: 2, orgId: 10, orgName: "F3 Nation", roleName: "user" }],
    });

    const { requireAdminPortalAccess } = await import("~/lib/auth/server");

    await expect(requireAdminPortalAccess()).rejects.toThrow(
      "reason=no-admin-access",
    );
  });

  it("returns session when user has editor role", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue(validPayload);
    getMyProfileMock.mockResolvedValue({
      roles: [
        {
          roleId: 3,
          orgId: 10,
          orgName: "F3 Nation",
          roleName: "editor",
        },
      ],
    });

    const { requireAdminPortalAccess } = await import("~/lib/auth/server");
    const user = await requireAdminPortalAccess();

    expect(user.email).toBe("admin@f3nation.test");
  });

  // -------------------------------------------------------------------------
  // requireAccessToken
  // -------------------------------------------------------------------------

  it("redirects to login when access token is missing", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });

    const { requireAccessToken } = await import("~/lib/auth/server");

    await expect(requireAccessToken()).rejects.toThrow(
      "redirect:/api/auth/login",
    );
  });

  it("redirects to invalid-session when token claims are bad", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "bad-claims-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "0", email: "admin@f3nation.test" },
    });

    const { requireAccessToken } = await import("~/lib/auth/server");

    await expect(requireAccessToken()).rejects.toThrow(
      "reason=invalid-session",
    );
  });

  it("returns access token when session is valid", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "good-token" }),
    });
    verifyAccessTokenMock.mockResolvedValue(validPayload);
    getMyProfileMock.mockResolvedValue({ roles: adminRoles });

    const { requireAccessToken } = await import("~/lib/auth/server");
    const token = await requireAccessToken();

    expect(token).toBe("good-token");
  });
});
