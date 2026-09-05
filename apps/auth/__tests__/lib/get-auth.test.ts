import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ db: {} }));
vi.mock("~/lib/better-auth-email", () => ({
  sendBetterAuthOtpEmail: vi.fn(),
}));
vi.mock("~/env", () => ({
  env: {
    BETTER_AUTH_SECRET: undefined,
    NEXT_PUBLIC_AUTH_URL: "http://localhost:3999",
  },
}));

describe("getAuth", () => {
  it("throws when BETTER_AUTH_SECRET is not configured", async () => {
    const { getAuth } = await import("~/lib/better-auth");
    await expect(getAuth()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});
