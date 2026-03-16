import { describe, it, expect, vi, afterEach } from "vitest";
import { createSessionValue, verifySessionValue } from "@/lib/auth/session";
import { SESSION_COOKIE_MAX_AGE } from "@/lib/auth/constants";

// Set up test environment
process.env.SESSION_SECRET =
  "test-secret-key-that-is-at-least-32-characters-long-for-testing";

describe("session", () => {
  const testInput = {
    sub: "123",
    email: "test@f3nation.com",
    name: "Dredd",
    userId: 42,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createSessionValue", () => {
    it("creates a non-empty token with a dot separator", () => {
      const token = createSessionValue(testInput);
      expect(token).toBeTruthy();
      expect(token).toContain(".");
    });

    it("encodes payload as base64url", () => {
      const token = createSessionValue(testInput);
      const [payloadB64] = token.split(".");
      const decoded = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8"),
      ) as Record<string, unknown>;
      expect(decoded.sub).toBe("123");
      expect(decoded.email).toBe("test@f3nation.com");
      expect(decoded.name).toBe("Dredd");
      expect(decoded.userId).toBe(42);
    });

    it("includes iat in the token", () => {
      const before = Math.floor(Date.now() / 1000);
      const token = createSessionValue(testInput);
      const after = Math.floor(Date.now() / 1000);

      const [payloadB64] = token.split(".");
      const decoded = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8"),
      ) as { iat: number };

      expect(decoded.iat).toBeGreaterThanOrEqual(before);
      expect(decoded.iat).toBeLessThanOrEqual(after);
    });

    it("creates different tokens for different inputs", () => {
      const token1 = createSessionValue(testInput);
      const token2 = createSessionValue({
        ...testInput,
        sub: "456",
        userId: 99,
      });
      expect(token1).not.toBe(token2);
    });

    it("works without optional name field", () => {
      const token = createSessionValue({
        sub: "123",
        email: "test@f3nation.com",
        userId: 42,
      });
      expect(token).toBeTruthy();
      const verified = verifySessionValue(token);
      expect(verified).not.toBeNull();
      expect(verified?.name).toBeUndefined();
    });
  });

  describe("verifySessionValue", () => {
    it("verifies a valid token round-trip", () => {
      const token = createSessionValue(testInput);
      const verified = verifySessionValue(token);
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe("123");
      expect(verified?.email).toBe("test@f3nation.com");
      expect(verified?.name).toBe("Dredd");
      expect(verified?.userId).toBe(42);
    });

    it("preserves userId through the round-trip", () => {
      const token = createSessionValue({
        ...testInput,
        userId: 999,
      });
      const verified = verifySessionValue(token);
      expect(verified?.userId).toBe(999);
    });

    it("rejects a tampered payload", () => {
      const token = createSessionValue(testInput);
      const tampered = "x" + token.slice(1);
      const verified = verifySessionValue(tampered);
      expect(verified).toBeNull();
    });

    it("rejects a tampered signature", () => {
      const token = createSessionValue(testInput);
      const [payload] = token.split(".");
      const fakeToken = `${payload}.fakesignature`;
      const verified = verifySessionValue(fakeToken);
      expect(verified).toBeNull();
    });

    it("rejects an expired session", () => {
      vi.useFakeTimers();
      const token = createSessionValue(testInput);
      vi.advanceTimersByTime((SESSION_COOKIE_MAX_AGE + 1) * 1000);
      const verified = verifySessionValue(token);
      expect(verified).toBeNull();
    });

    it("accepts a session just before expiry", () => {
      vi.useFakeTimers();
      const token = createSessionValue(testInput);
      // Advance to 1 second before max age
      vi.advanceTimersByTime((SESSION_COOKIE_MAX_AGE - 1) * 1000);
      const verified = verifySessionValue(token);
      expect(verified).not.toBeNull();
    });

    it("rejects empty string", () => {
      expect(verifySessionValue("")).toBeNull();
    });

    it("rejects string without dot", () => {
      expect(verifySessionValue("abc")).toBeNull();
      expect(verifySessionValue("not-a-token")).toBeNull();
    });

    it("rejects string with multiple dots (invalid format)", () => {
      expect(verifySessionValue("a.b.c")).toBeNull();
    });

    it("rejects base64 that decodes to invalid JSON", () => {
      const invalidB64 = Buffer.from("not json").toString("base64url");
      const sig = "fakesig";
      expect(verifySessionValue(`${invalidB64}.${sig}`)).toBeNull();
    });

    it("uses timing-safe comparison (does not short-circuit)", () => {
      // This is a structural test: the function should return null for
      // signatures of wrong length, not throw
      const token = createSessionValue(testInput);
      const [payload] = token.split(".");
      const shortSig = "abc";
      expect(verifySessionValue(`${payload}.${shortSig}`)).toBeNull();
    });
  });
});
