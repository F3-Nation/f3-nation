import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mocks must be declared before imports that trigger module evaluation.
vi.mock("@f3nation/sso-next", async () => {
  const actual = await vi.importActual("@f3nation/sso-next");
  return { ...(actual as object), verifyAccessToken: vi.fn() };
});

vi.mock("@/lib/auth/oauth", () => ({
  sso: { refreshToken: vi.fn() },
}));

vi.mock("@/lib/logging", () => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

describe("proxy middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(pathname: string): NextRequest {
    return new NextRequest(`http://localhost:3003${pathname}`);
  }

  it("allows /health through without any auth check", async () => {
    const { proxy } = await import("../src/proxy");
    const response = await proxy(makeRequest("/health"));

    // NextResponse.next() produces a 200 response with no Location header.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows / through without auth check", async () => {
    const { proxy } = await import("../src/proxy");
    const response = await proxy(makeRequest("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated request to a protected path", async () => {
    const { proxy } = await import("../src/proxy");
    const response = await proxy(makeRequest("/profile"));

    // No tokens → redirect to login at "/"
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(
      /^http:\/\/localhost:3003/,
    );
  });
});
