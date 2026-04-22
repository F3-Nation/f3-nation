import { describe, it, expect } from "vitest";
import {
  isAccessTokenExpired,
  parseAccessTokenPayload,
} from "@/lib/auth/tokens";

function createToken(payload: Record<string, unknown>) {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return `${encodedHeader}.${encodedPayload}.signature`;
}

describe("auth tokens", () => {
  it("parses JWT payloads", () => {
    const token = createToken({ sub: "42", email: "test@f3.com", exp: 9999 });

    expect(parseAccessTokenPayload(token)).toEqual(
      expect.objectContaining({
        sub: "42",
        email: "test@f3.com",
        exp: 9999,
      }),
    );
  });

  it("returns null for invalid JWT format", () => {
    expect(parseAccessTokenPayload("not-a-jwt")).toBeNull();
  });

  it("treats malformed payloads as expired", () => {
    expect(isAccessTokenExpired("not-a-jwt")).toBe(true);
  });

  it("treats tokens without exp as expired", () => {
    const token = createToken({ sub: "42", email: "test@f3.com" });
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("accepts tokens whose exp is comfortably in the future", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createToken({ sub: "42", exp: futureExp });
    expect(isAccessTokenExpired(token)).toBe(false);
  });

  it("treats nearly-expired tokens as expired when within skew", () => {
    const nearExp = Math.floor(Date.now() / 1000) + 30;
    const token = createToken({ sub: "42", exp: nearExp });
    expect(isAccessTokenExpired(token)).toBe(true);
  });
});
