import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rateLimit } = vi.hoisted(() => ({
  rateLimit: vi.fn((_key: string, _limit: number, _windowMs: number) => ({
    allowed: false,
  })),
}));

vi.mock("~/lib/rate-limit", () => ({ rateLimit }));
vi.mock("~/lib/email-mfa", () => ({
  EmailCodeRateLimitedError: class EmailCodeRateLimitedError extends Error {},
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/env", () => ({ env: { NODE_ENV: "production" } }));

const { POST } = await import("~/app/api/verify-email/route");
const { EmailCodeRateLimitedError, sendEmailCode } =
  await import("~/lib/email-mfa");
const { logError } = await import("~/lib/logging");

function verifyEmail(headers?: HeadersInit) {
  return POST(
    new Request("https://auth.test.invalid/api/verify-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "pax@example.test" }),
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/verify-email rate-limit key", () => {
  it("keys on the proxy-appended hop, not the caller-set ones", async () => {
    const res = await verifyEmail({
      "x-forwarded-for": "6.6.6.6, 203.0.113.7",
    });
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith(
      "verify-email:203.0.113.7",
      10,
      60 * 1000,
    );
  });

  it("keys on 'unknown' when x-forwarded-for is absent or has no usable entry", async () => {
    await verifyEmail();
    await verifyEmail({ "x-forwarded-for": " , " });
    expect(rateLimit.mock.calls.map(([key]) => key)).toEqual([
      "verify-email:unknown",
      "verify-email:unknown",
    ]);
  });
});

describe("POST /api/verify-email code sends", () => {
  it("answers 429 when the address has had too many codes, without logging an error", async () => {
    rateLimit.mockReturnValueOnce({ allowed: true });
    vi.mocked(sendEmailCode).mockRejectedValueOnce(
      new EmailCodeRateLimitedError(),
    );

    const res = await verifyEmail();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error:
        "Too many codes requested. Please wait a few minutes and try again.",
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("still answers 500 when sending fails for another reason", async () => {
    rateLimit.mockReturnValueOnce({ allowed: true });
    vi.mocked(sendEmailCode).mockRejectedValueOnce(new Error("smtp down"));

    const res = await verifyEmail();

    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
