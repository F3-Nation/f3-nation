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
  // Importing ~/lib/better-auth pulls in better-auth, @better-auth/oauth-provider,
  // and the full Drizzle schema before this test ever runs — a transform/import
  // cost variable enough under CI load to occasionally exceed the default 5s
  // timeout (observed passing at ~2.5s and timing out at exactly 5000ms on the
  // same commit). Bump the timeout rather than the default for every test.
  it("throws when BETTER_AUTH_SECRET is not configured", async () => {
    const { getAuth } = await import("~/lib/better-auth");
    await expect(getAuth()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  }, 15000);
});
