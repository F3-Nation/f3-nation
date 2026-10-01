import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getAuthMock = vi.fn();
const headersMock = vi.fn(() => new Headers());
const envMock = { AUTH_USE_BETTER_AUTH: false };

vi.mock("~/lib/auth", () => ({ auth: authMock }));
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));

describe("getCurrentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.AUTH_USE_BETTER_AUTH = false;
    headersMock.mockImplementation(() => new Headers());
  });

  it("reads NextAuth's session when the flag is off", async () => {
    authMock.mockResolvedValue({
      user: { id: "6161", email: "pax@f3.com", name: "Pax" },
      authTime: "2026-01-01T00:00:00.000Z",
    });

    const { getCurrentSession } = await import("~/lib/current-session");
    const session = await getCurrentSession();

    expect(session).toEqual({
      user: { id: "6161", email: "pax@f3.com", name: "Pax" },
      authTime: "2026-01-01T00:00:00.000Z",
    });
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it("returns null when the flag is off and there's no NextAuth session", async () => {
    authMock.mockResolvedValue(null);

    const { getCurrentSession } = await import("~/lib/current-session");
    expect(await getCurrentSession()).toBeNull();
  });

  it("reads Better Auth's session when the flag is on, mapped to the same shape", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const createdAt = new Date("2026-02-02T00:00:00.000Z");
    getAuthMock.mockResolvedValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { createdAt },
          user: { id: "6161", email: "pax@f3.com", name: "Pax" },
        }),
      },
    });

    const { getCurrentSession } = await import("~/lib/current-session");
    const session = await getCurrentSession();

    expect(session).toEqual({
      user: { id: "6161", email: "pax@f3.com", name: "Pax" },
      authTime: "2026-02-02T00:00:00.000Z",
    });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("returns null when the flag is on and Better Auth has no session", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    getAuthMock.mockResolvedValue({
      api: { getSession: vi.fn().mockResolvedValue(null) },
    });

    const { getCurrentSession } = await import("~/lib/current-session");
    expect(await getCurrentSession()).toBeNull();
  });
});
