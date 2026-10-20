import { describe, expect, it } from "vitest";

import { buildOtpCallbackUrl } from "~/utils/otp-callback-url";

const parse = (url: string) => new URL(url, "https://map.example.test");

describe("buildOtpCallbackUrl", () => {
  it("passes a normal six-digit code through unchanged", () => {
    const url = buildOtpCallbackUrl({
      email: "user@example.com",
      code: "123456",
      callbackUrl: "/",
    });

    expect(url).toBe(
      "/api/auth/callback/otp?email=user%40example.com&token=123456&callbackUrl=%2F",
    );
  });

  it("keeps & and # in the code inside the token parameter", () => {
    const { pathname, searchParams, hash } = parse(
      buildOtpCallbackUrl({
        email: "user@example.com",
        code: "12&callbackUrl=https://evil.test#x",
        callbackUrl: "/map",
      }),
    );

    expect(pathname).toBe("/api/auth/callback/otp");
    expect(hash).toBe("");
    expect(searchParams.get("token")).toBe(
      "12&callbackUrl=https://evil.test#x",
    );
    expect(searchParams.getAll("callbackUrl")).toEqual(["/map"]);
    expect(searchParams.getAll("email")).toEqual(["user@example.com"]);
  });

  it("round-trips a plus-addressed email and a callbackUrl with its own query", () => {
    const { searchParams } = parse(
      buildOtpCallbackUrl({
        email: "a+b@example.com",
        code: "123456",
        callbackUrl: "/map?lat=1&lng=2#z",
      }),
    );

    expect(searchParams.get("email")).toBe("a+b@example.com");
    expect(searchParams.get("callbackUrl")).toBe("/map?lat=1&lng=2#z");
    expect([...searchParams.keys()]).toEqual(["email", "token", "callbackUrl"]);
  });
});
