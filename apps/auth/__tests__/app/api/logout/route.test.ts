import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("~/lib/better-auth", () => ({
  getAuth: vi.fn(),
  deleteBetterAuthOAuthTokens: vi.fn(),
}));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/lib/oauth", () => ({ revokeAllUserTokens: vi.fn() }));

const { getCurrentSession } = await import("~/lib/current-session");
const { deleteBetterAuthOAuthTokens, getAuth } =
  await import("~/lib/better-auth");
const { logError } = await import("~/lib/logging");
const { revokeAllUserTokens } = await import("~/lib/oauth");
const { POST } = await import("../../../../src/app/api/logout/route");

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
  vi.mocked(getCurrentSession).mockResolvedValue({
    user: { id: "42", email: null, name: null },
  });
});

describe("POST /api/logout", () => {
  it("returns 401 without a session and revokes nothing", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(revokeAllUserTokens).not.toHaveBeenCalled();
    expect(deleteBetterAuthOAuthTokens).not.toHaveBeenCalled();
  });

  it("revokes the hand-rolled tokens only, while the flag is off", async () => {
    const res = await POST();

    expect(await res.json()).toEqual({ loggedOut: true });
    expect(revokeAllUserTokens).toHaveBeenCalledWith(42);
    expect(deleteBetterAuthOAuthTokens).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("also deletes the Better Auth OAuth tokens while the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const betterAuth = {};
    vi.mocked(getAuth).mockResolvedValue(betterAuth as never);

    const res = await POST();

    expect(await res.json()).toEqual({ loggedOut: true });
    expect(revokeAllUserTokens).toHaveBeenCalledWith(42);
    expect(deleteBetterAuthOAuthTokens).toHaveBeenCalledWith(betterAuth, "42");
  });

  it("returns a 500 and logs when deleting the Better Auth tokens fails", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(getAuth).mockResolvedValue({} as never);
    vi.mocked(deleteBetterAuthOAuthTokens).mockRejectedValue(
      new Error("db down"),
    );

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(logError).toHaveBeenCalledWith(
      "auth.logout.better_auth_token_deletion_failed",
      {},
      expect.any(Error),
    );
  });
});
