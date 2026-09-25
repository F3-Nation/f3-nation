import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = { select: vi.fn(() => chain([])) };

interface FakeCookie {
  name: string;
  value: string;
}

const cookieStoreMock = {
  getAll: vi.fn<() => FakeCookie[]>(),
  delete: vi.fn(),
};

const envMock = {
  NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid",
  AUTH_USE_BETTER_AUTH: false,
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/current-session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("~/lib/better-auth", () => ({ getAuth: vi.fn() }));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/lib/oauth", () => ({ revokeAllUserTokens: vi.fn() }));
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(cookieStoreMock)),
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

const { getCurrentSession } = await import("~/lib/current-session");
const { getAuth } = await import("~/lib/better-auth");
const { logError } = await import("~/lib/logging");
const { revokeAllUserTokens } = await import("~/lib/oauth");
const { GET } = await import("../../../../../src/app/api/oauth/logout/route");

function makeRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

const ALL_FIVE_PREFIXES: FakeCookie[] = [
  { name: "next-auth.session-token", value: "a" },
  { name: "__Secure-next-auth.session-token", value: "b" },
  { name: "authjs.session-token", value: "c" },
  { name: "__Secure-authjs.session-token", value: "d" },
  { name: "better-auth.session_token", value: "e" },
  { name: "__Secure-better-auth.session_token", value: "f" },
  { name: "theme", value: "dark" },
];

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
  dbMock.select.mockReturnValue(chain([]));
  cookieStoreMock.getAll.mockReturnValue(ALL_FIVE_PREFIXES);
  vi.mocked(getCurrentSession).mockResolvedValue(null);
});

describe("GET /api/oauth/logout", () => {
  it("clears every auth cookie regardless of AUTH_USE_BETTER_AUTH, passing secure:true for __Secure- names, and leaves unrelated cookies alone", async () => {
    const res = await GET(
      makeRequest("https://auth.test.invalid/api/oauth/logout"),
    );

    expect(res.status).toBe(307);
    expect(cookieStoreMock.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "theme" }),
    );

    const deletedNames = cookieStoreMock.delete.mock.calls.map(
      (call) => (call[0] as { name: string }).name,
    );
    expect(deletedNames.sort()).toEqual(
      [
        "next-auth.session-token",
        "__Secure-next-auth.session-token",
        "authjs.session-token",
        "__Secure-authjs.session-token",
        "better-auth.session_token",
        "__Secure-better-auth.session_token",
      ].sort(),
    );

    for (const call of cookieStoreMock.delete.mock.calls) {
      const arg = call[0] as { name: string; path: string; secure: boolean };
      expect(arg.path).toBe("/");
      expect(arg.secure).toBe(arg.name.startsWith("__Secure-"));
    }
  });

  it("revokes the Better Auth session and forwards its Set-Cookie headers when AUTH_USE_BETTER_AUTH is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const signOutResponse = new Response(null, {
      headers: { "set-cookie": "better-auth.session_token=; Max-Age=0" },
    });
    const signOut = vi.fn().mockResolvedValue(signOutResponse);
    vi.mocked(getAuth).mockResolvedValue({
      api: { signOut },
    } as never);

    const res = await GET(
      makeRequest("https://auth.test.invalid/api/oauth/logout"),
    );

    expect(signOut).toHaveBeenCalledWith(
      expect.objectContaining({ asResponse: true }),
    );
    expect(res.headers.get("set-cookie")).toContain(
      "better-auth.session_token=",
    );
  });

  it("logs and continues (still redirects) when the Better Auth sign-out call throws", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(getAuth).mockResolvedValue({
      api: { signOut: vi.fn().mockRejectedValue(new Error("boom")) },
    } as never);

    const res = await GET(
      makeRequest("https://auth.test.invalid/api/oauth/logout"),
    );

    expect(res.status).toBe(307);
    expect(logError).toHaveBeenCalledWith(
      "auth.oauth_logout.better_auth_signout_failed",
      {},
      expect.any(Error),
    );
  });

  it("revokes OAuth refresh tokens for the currently authenticated user", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      user: { id: "42", email: null, name: null },
    });

    await GET(makeRequest("https://auth.test.invalid/api/oauth/logout"));

    expect(revokeAllUserTokens).toHaveBeenCalledWith(42);
  });
});
