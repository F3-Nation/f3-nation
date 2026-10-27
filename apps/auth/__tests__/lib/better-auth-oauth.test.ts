import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
  env: {
    NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid",
    AUTH_USE_BETTER_AUTH: true,
  },
}));

const handler = vi.fn<(request: Request) => Promise<Response>>();
vi.mock("~/lib/better-auth", () => ({
  BETTER_AUTH_BASE_PATH: "/api/auth2",
  getAuth: vi.fn(() => Promise.resolve({ handler })),
}));

const { forwardToBetterAuth } = await import("../../src/lib/better-auth-oauth");

beforeEach(() => {
  handler.mockReset();
  handler.mockResolvedValue(new Response("ok"));
});

function forwarded() {
  return handler.mock.calls[0]![0];
}

describe("forwardToBetterAuth", () => {
  it("rewrites the path onto Better Auth's mount and keeps the query and headers", async () => {
    await forwardToBetterAuth(
      new Request(
        "http://internal:8080/api/oauth/authorize?client_id=c&scope=openid",
        { headers: { cookie: "better-auth.session_token=s", "x-test": "1" } },
      ),
      "authorize",
    );

    const request = forwarded();
    expect(request.url).toBe(
      "https://auth.test.invalid/api/auth2/oauth2/authorize?client_id=c&scope=openid",
    );
    expect(request.method).toBe("GET");
    expect(request.headers.get("cookie")).toBe("better-auth.session_token=s");
    expect(request.headers.get("x-test")).toBe("1");
    expect(request.body).toBeNull();
  });

  it("keeps a POST body, and drops cookies when asked", async () => {
    await forwardToBetterAuth(
      new Request("https://auth.test.invalid/api/oauth/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: "better-auth.session_token=s",
        },
        body: "token=t&client_id=c",
      }),
      "revoke",
      { dropCookies: true },
    );

    const request = forwarded();
    expect(request.url).toBe(
      "https://auth.test.invalid/api/auth2/oauth2/revoke",
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(await request.text()).toBe("token=t&client_id=c");
  });

  it("sends a body the caller already read", async () => {
    await forwardToBetterAuth(
      new Request("https://auth.test.invalid/api/oauth/token", {
        method: "POST",
        body: "consumed",
      }),
      "token",
      { body: "grant_type=refresh_token" },
    );

    expect(await forwarded().text()).toBe("grant_type=refresh_token");
  });

  it("returns Better Auth's response as is", async () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "https://rp.example.com/cb?code=x" },
    });
    handler.mockResolvedValue(response);

    await expect(
      forwardToBetterAuth(
        new Request("https://auth.test.invalid/api/oauth/authorize"),
        "authorize",
      ),
    ).resolves.toBe(response);
  });
});
