import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ db: {} }));
vi.mock("~/lib/email-mfa", () => ({
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/env", () => ({
  env: { AUTH_SECRET: "test-secret", NODE_ENV: "production" },
}));

const { authOptions } = await import("../../src/lib/auth-options");

describe("authOptions session cookie in production", () => {
  it("is SameSite=Lax, so a cross-site POST doesn't carry it", () => {
    expect(authOptions.cookies?.sessionToken).toEqual({
      name: "__session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    });
  });
});
