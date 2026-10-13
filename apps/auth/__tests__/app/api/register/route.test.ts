import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkEmailCode } = vi.hoisted(() => ({
  checkEmailCode: vi.fn<(email: string, code: string) => Promise<boolean>>(),
}));

vi.mock("~/lib/email-mfa", () => ({ checkEmailCode }));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true })),
}));
vi.mock("~/env", () => ({
  env: {
    NEXT_PUBLIC_API_URL: "https://api.test.invalid",
    NEXT_PUBLIC_AUTH_URL: "https://auth.test.invalid",
    API_KEY: "test-key",
  },
}));

const { POST } = await import("~/app/api/register/route");

const fetchMock = vi.fn<typeof fetch>();

function register(body: Record<string, unknown>) {
  return POST(
    new Request("https://auth.test.invalid/api/register", {
      method: "POST",
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
}

const valid = {
  email: "New-PAX@Example.test",
  code: "123456",
  firstName: "Test",
  lastName: "PAX",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset().mockResolvedValue(Response.json({ id: 1 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/register", () => {
  it.each([
    ["no code", { ...valid, code: undefined }],
    ["a wrong or expired code", valid],
  ])("refuses to create an account with %s", async (_name, body) => {
    checkEmailCode.mockResolvedValue(false);
    const res = await register(body);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the account once the emailed code checks out", async () => {
    checkEmailCode.mockResolvedValue(true);
    const res = await register(valid);
    expect(res.status).toBe(200);
    expect(checkEmailCode).toHaveBeenCalledExactlyOnceWith(
      "new-pax@example.test",
      "123456",
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.test.invalid/v1/user");
    const payload = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(payload.email).toBe("new-pax@example.test");
    expect(payload).not.toHaveProperty("code");
  });
});
