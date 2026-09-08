import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = { AUTH_USE_BETTER_AUTH: false };
vi.mock("~/env", () => ({ env: envMock }));

const getAuthMock = vi.fn();
vi.mock("~/lib/better-auth", () => ({ getAuth: getAuthMock }));

const handlersMock = {
  GET: vi.fn(async () => new Response(null, { status: 200 })),
  POST: vi.fn(async () => new Response(null, { status: 200 })),
  PATCH: vi.fn(async () => new Response(null, { status: 200 })),
  PUT: vi.fn(async () => new Response(null, { status: 200 })),
  DELETE: vi.fn(async () => new Response(null, { status: 200 })),
};
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => handlersMock),
}));

const { GET, POST } =
  await import("../../../../../src/app/api/auth2/[...all]/route");

function makeRequest(method: string): NextRequest {
  return { method } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.AUTH_USE_BETTER_AUTH = false;
});

describe("auth2 catch-all mount", () => {
  it("404s without constructing the Better Auth instance when the flag is off", async () => {
    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(404);
    expect(getAuthMock).not.toHaveBeenCalled();
  });

  it("dispatches to the Better Auth GET handler when the flag is on", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    getAuthMock.mockResolvedValue({});

    await GET(makeRequest("GET"));

    expect(getAuthMock).toHaveBeenCalledOnce();
    expect(handlersMock.GET).toHaveBeenCalledOnce();
  });

  it("dispatches POST requests to the Better Auth POST handler", async () => {
    envMock.AUTH_USE_BETTER_AUTH = true;
    getAuthMock.mockResolvedValue({});

    await POST(makeRequest("POST"));

    expect(handlersMock.POST).toHaveBeenCalledOnce();
  });
});
