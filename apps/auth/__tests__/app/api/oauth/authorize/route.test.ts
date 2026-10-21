import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = { select: vi.fn(() => chain([])) };

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("~/lib/oauth", () => ({
  createAuthorizationCode: vi.fn(),
  getClient: vi.fn(),
  validateRedirectUri: vi.fn(),
  validateScopes: vi.fn(),
}));
vi.mock("~/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 29 })),
}));
const envMock = {
  NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid",
  AUTH_USE_BETTER_AUTH: false,
};
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("~/lib/better-auth-oauth", () => ({ forwardToBetterAuth: vi.fn() }));

const { auth } = await import("~/lib/auth");
const {
  createAuthorizationCode,
  getClient,
  validateRedirectUri,
  validateScopes,
} = await import("~/lib/oauth");
const { forwardToBetterAuth } = await import("~/lib/better-auth-oauth");
const { rateLimit } = await import("~/lib/rate-limit");
const { GET } =
  await import("../../../../../src/app/api/oauth/authorize/route");

// route.ts only ever calls request.headers.get(...) and reads request.url —
// a minimal fake avoids depending on Next.js's own NextRequest runtime.
function makeRequest(url: string): NextRequest {
  return { url, headers: new Headers() } as unknown as NextRequest;
}

const CLIENT = { id: "some-client", scopes: "openid profile email" };
const AUTH_TIME = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
  vi.mocked(getClient).mockResolvedValue(CLIENT as never);
  vi.mocked(validateRedirectUri).mockReturnValue(true);
  vi.mocked(validateScopes).mockReturnValue(true);
  vi.mocked(auth).mockResolvedValue({
    user: { id: "42" },
    authTime: AUTH_TIME,
  } as never);
  dbMock.select.mockReturnValue(
    chain([{ meta: { onboarding_completed: true } }]),
  );
  vi.mocked(createAuthorizationCode).mockResolvedValue("generated-code");
});

describe("GET /authorize — nonce/authTime wiring", () => {
  const baseUrl =
    "https://auth.test.invalid/api/oauth/authorize" +
    "?response_type=code&client_id=some-client" +
    "&redirect_uri=https://example.com/callback" +
    "&code_challenge=abc&code_challenge_method=S256";

  it("passes the request's nonce query param and the session's authTime through to createAuthorizationCode", async () => {
    const res = await GET(makeRequest(`${baseUrl}&nonce=replay-guard-123`));

    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "replay-guard-123",
        authTime: AUTH_TIME,
      }),
    );
  });

  it("passes nonce as undefined (not null or empty string) when the request omits it", async () => {
    await GET(makeRequest(baseUrl));

    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: undefined }),
    );
  });

  it("normalizes an empty nonce=&... to undefined rather than echoing a literal empty claim", async () => {
    await GET(makeRequest(`${baseUrl}&nonce=`));

    expect(createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: undefined }),
    );
  });
});

describe("GET /authorize — AUTH_USE_BETTER_AUTH", () => {
  const url =
    "https://auth.test.invalid/api/oauth/authorize?response_type=code&client_id=some-client";

  it("runs the hand-rolled flow, never Better Auth, while the flag is off", async () => {
    await GET(
      makeRequest(
        `${url}&redirect_uri=https://example.com/callback&code_challenge=abc&code_challenge_method=S256`,
      ),
    );

    expect(forwardToBetterAuth).not.toHaveBeenCalled();
    expect(createAuthorizationCode).toHaveBeenCalled();
  });

  it("hands the request to Better Auth's authorize endpoint while the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    const response = new Response(null, { status: 302 });
    vi.mocked(forwardToBetterAuth).mockResolvedValue(response);
    const request = makeRequest(url);

    await expect(GET(request)).resolves.toBe(response);

    expect(forwardToBetterAuth).toHaveBeenCalledWith(request, "authorize");
    expect(getClient).not.toHaveBeenCalled();
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("keeps the per-IP rate limit in front of Better Auth", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await GET(makeRequest(url));

    expect(res.status).toBe(429);
    expect(forwardToBetterAuth).not.toHaveBeenCalled();
  });
});
