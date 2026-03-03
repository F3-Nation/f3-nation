import { describe, it, expect } from "vitest";
import {
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth/session";

// Set up test environment
process.env.SESSION_SECRET =
  "test-secret-key-that-is-at-least-32-characters-long-for-testing";

describe("session", () => {
  const testPayload: SessionPayload = {
    sub: "123",
    email: "test@f3nation.com",
    name: "Dredd",
    iat: Math.floor(Date.now() / 1000),
  };

  it("should sign and verify a valid session", async () => {
    const token = await signSession(testPayload);
    expect(token).toBeTruthy();
    expect(token).toContain(".");

    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe("123");
    expect(verified?.email).toBe("test@f3nation.com");
    expect(verified?.name).toBe("Dredd");
  });

  it("should reject a tampered token", async () => {
    const token = await signSession(testPayload);
    // Tamper with the payload portion
    const tampered = "x" + token.slice(1);
    const verified = await verifySession(tampered);
    expect(verified).toBeNull();
  });

  it("should reject an expired session", async () => {
    const expiredPayload: SessionPayload = {
      ...testPayload,
      iat: Math.floor(Date.now() / 1000) - 11 * 24 * 60 * 60, // 11 days ago
    };
    const token = await signSession(expiredPayload);
    const verified = await verifySession(token);
    expect(verified).toBeNull();
  });

  it("should reject malformed tokens", async () => {
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("abc")).toBeNull();
    expect(await verifySession("a.b.c")).toBeNull();
    expect(await verifySession("not-a-token")).toBeNull();
  });

  it("should reject a token with wrong signature", async () => {
    const token = await signSession(testPayload);
    const [payload] = token.split(".");
    const fakeToken = `${payload}.fakesignature`;
    const verified = await verifySession(fakeToken);
    expect(verified).toBeNull();
  });
});
