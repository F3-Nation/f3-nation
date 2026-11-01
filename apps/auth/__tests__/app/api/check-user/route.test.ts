import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rateLimit } = vi.hoisted(() => ({
  rateLimit: vi.fn((_key: string, _limit: number, _windowMs: number) => ({
    allowed: false,
  })),
}));

vi.mock("~/lib/rate-limit", () => ({ rateLimit }));
// Never reached: the limiter rejects first. Mocked so no database is needed.
vi.mock("~/lib/db", () => ({ db: {} }));

const { POST } = await import("~/app/api/check-user/route");

function checkUser(headers?: HeadersInit) {
  return POST(
    new Request("https://auth.test.invalid/api/check-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "pax@example.test" }),
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/check-user rate-limit key", () => {
  it("keys on the proxy-appended hop, not the caller-set ones", async () => {
    const res = await checkUser({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith(
      "check-user:203.0.113.7",
      5,
      60 * 1000,
    );
  });

  it("gives every forged prefix from one client the same key", async () => {
    for (const forged of ["1.1.1.1", "2.2.2.2", "not-an-ip"]) {
      await checkUser({ "x-forwarded-for": `${forged}, 203.0.113.7` });
    }
    expect(new Set(rateLimit.mock.calls.map(([key]) => key))).toEqual(
      new Set(["check-user:203.0.113.7"]),
    );
  });

  it("keys on 'unknown' when x-forwarded-for is absent or has no usable entry", async () => {
    await checkUser();
    await checkUser({ "x-forwarded-for": " , " });
    expect(rateLimit.mock.calls.map(([key]) => key)).toEqual([
      "check-user:unknown",
      "check-user:unknown",
    ]);
  });
});
