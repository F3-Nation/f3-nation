import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createSessionValue,
  verifySessionValue,
} from "@/lib/auth/session";
import { SESSION_COOKIE_MAX_AGE } from "@/lib/auth/constants";

// Set up test environment
process.env.SESSION_SECRET =
  "test-secret-key-that-is-at-least-32-characters-long-for-testing";

describe("session", () => {
  const testInput = {
    sub: "123",
    email: "test@f3nation.com",
    name: "Dredd",
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create and verify a valid session", () => {
    const token = createSessionValue(testInput);
    expect(token).toBeTruthy();
    expect(token).toContain(".");

    const verified = verifySessionValue(token);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe("123");
    expect(verified?.email).toBe("test@f3nation.com");
    expect(verified?.name).toBe("Dredd");
  });

  it("should reject a tampered token", () => {
    const token = createSessionValue(testInput);
    // Tamper with the payload portion
    const tampered = "x" + token.slice(1);
    const verified = verifySessionValue(tampered);
    expect(verified).toBeNull();
  });

  it("should reject an expired session", () => {
    vi.useFakeTimers();
    // Create a valid token at the current (fake) time
    const token = createSessionValue(testInput);
    // Advance time past the max session age (10 days + 1 second)
    vi.advanceTimersByTime((SESSION_COOKIE_MAX_AGE + 1) * 1000);
    // Token should now be considered expired
    const verified = verifySessionValue(token);
    expect(verified).toBeNull();
  });

  it("should reject malformed tokens", () => {
    expect(verifySessionValue("")).toBeNull();
    expect(verifySessionValue("abc")).toBeNull();
    expect(verifySessionValue("a.b.c")).toBeNull();
    expect(verifySessionValue("not-a-token")).toBeNull();
  });

  it("should reject a token with wrong signature", () => {
    const token = createSessionValue(testInput);
    const [payload] = token.split(".");
    const fakeToken = `${payload}.fakesignature`;
    const verified = verifySessionValue(fakeToken);
    expect(verified).toBeNull();
  });
});
