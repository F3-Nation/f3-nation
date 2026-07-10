import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const verifyAccessTokenMock = vi.fn();
const logDebugMock = vi.fn();
const logWarnMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth/tokens", () => ({
  verifyAccessTokenPayload: verifyAccessTokenPayloadMock,
}));

vi.mock("@/lib/logging", () => ({
  logDebug: logDebugMock,
  logWarn: logWarnMock,
}));

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
    expect(verifyAccessTokenPayloadMock).not.toHaveBeenCalled();
  });

  it("returns null when token verification fails", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-expired" }),
    });
    verifyAccessTokenPayloadMock.mockResolvedValue(null);

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(logDebugMock).toHaveBeenCalledWith(
      "me.auth.session_token_expired",
      {},
    );
  });

  it("logs a warning and returns null when verification fails with a non-expired code", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-invalid-sig" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "invalid_signature",
      error: "Token signature verification failed",
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith("me.auth.session_verify_failed", {
      code: "invalid_signature",
      message: "Token signature verification failed",
    });
  });

  it("logs a warning and returns null for an invalid_token failure code", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-invalid" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: false,
      code: "invalid_token",
      error: "Token verification failed",
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(logWarnMock).toHaveBeenCalledWith("me.auth.session_verify_failed", {
      code: "invalid_token",
      message: "Token verification failed",
    });
  });

  it("returns null when payload is missing email", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-no-email" }),
    });
    verifyAccessTokenPayloadMock.mockResolvedValue({ sub: "42" });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns null when token subject is not a positive number", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-nan-sub" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "not-a-number", email: "test@example.com" },
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns null when token subject is a non-integer number", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-float-sub" }),
    });
    verifyAccessTokenMock.mockResolvedValue({
      ok: true,
      payload: { sub: "1.5", email: "test@example.com" },
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns null when token subject is zero or negative", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-zero-sub" }),
    });
    verifyAccessTokenPayloadMock.mockResolvedValue({
      sub: "0",
      email: "test@example.com",
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("returns normalized session payload for valid token payload", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "token-valid" }),
    });
    verifyAccessTokenPayloadMock.mockResolvedValue({
      sub: "42",
      email: "test@example.com",
    });

    const { getSessionUser } = await import("@/lib/auth/server");
    const user = await getSessionUser();

    // The fourth positional arg (`true`) enables the client_id fallback that
    // F3 tokens require — assert it is passed so a transposition or omission
    // fails loudly rather than silently breaking every real session.
    expect(verifyAccessTokenMock).toHaveBeenCalledWith(
      "token-valid",
      "https://auth.test.com",
      "me-client",
      true,
    );
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
      get: vi.fn().mockReturnValue({ value: "token-auth" }),
    });
    verifyAccessTokenPayloadMock.mockResolvedValue({
      sub: "7",
      email: "auth@example.com",
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
