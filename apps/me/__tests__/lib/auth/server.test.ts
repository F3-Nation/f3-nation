import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const verifyAccessTokenMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@acme/sso", async () => {
  const actual = await vi.importActual("@acme/sso");
  return { ...actual, verifyAccessToken: verifyAccessTokenMock };
});

vi.mock("@/env", () => ({
  env: {
    AUTH_PROVIDER_URL: "https://auth.test.com",
    OAUTH_CLIENT_ID: "me-client",
  },
}));

vi.mock("@/lib/logging", () => ({ logDebug: vi.fn(), logWarn: vi.fn() }));

describe("auth server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns null when access token cookie is missing", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns null when token verification fails", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "expired",
      error: "Token expired",
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns null when token subject is not a positive number", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "not-a-number", email: "test@example.com" },
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns normalized session payload for valid token payload", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "42", email: "test@example.com" },
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toEqual({
      sub: "42",
      email: "test@example.com",
      userId: 42,
    });
  });

  it("requireAuth redirects when session user is missing", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });

    const { requireAuth } = await import("@/lib/auth/server");

    await expect(requireAuth()).rejects.toThrow("redirect:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("requireAuth returns session payload when authenticated", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "7", email: "auth@example.com" },
    });

    const { requireAuth } = await import("@/lib/auth/server");
    const user = await requireAuth();

    expect(user).toEqual({
      sub: "7",
      email: "auth@example.com",
      userId: 7,
    });
  });
});
