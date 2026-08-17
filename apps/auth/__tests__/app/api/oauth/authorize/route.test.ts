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
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid" },
}));

const { auth } = await import("~/lib/auth");
const {
  createAuthorizationCode,
  getClient,
  validateRedirectUri,
  validateScopes,
} = await import("~/lib/oauth");
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
