import { describe, expect, it } from "vitest";

import { isValidCallbackUrl } from "~/lib/callback-url";

const authUrl = "https://auth.f3nation.test";

describe("callback URL validation", () => {
  it.each([
    "/",
    "/api/oauth/authorize?state=a%2Bb&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback",
    "/account#profile",
    "https://auth.f3nation.test/api/oauth/authorize?state=a%2Bb",
    "https://auth.f3nation.test:443/account",
  ])("allows Auth destinations: %j", (callback) => {
    expect(isValidCallbackUrl(callback, authUrl)).toBe(true);
  });

  it("allows relative and absolute callbacks for local HTTP Auth", () => {
    const localAuthUrl = "http://localhost:3004";
    expect(isValidCallbackUrl("/account", localAuthUrl)).toBe(true);
    expect(isValidCallbackUrl(`${localAuthUrl}/account`, localAuthUrl)).toBe(
      true,
    );
  });

  it.each([
    "",
    "account",
    "https://external.example/account",
    "http://auth.f3nation.test/account",
    "https://auth.f3nation.test:444/account",
    "https://auth.f3nation.test@external.example/account",
    "//external.example/account",
    "//auth.f3nation.test/account",
    "/\\external.example/account",
    "/\t/external.example/account",
    "/\n/external.example/account",
    "javascript:void(0)",
    "java\tscript:void(0)",
    "data:text/html,<p>External document</p>",
    "blob:https://auth.f3nation.test/id",
    "https://[invalid",
  ])("rejects unsafe or malformed callbacks: %j", (callback) => {
    expect(isValidCallbackUrl(callback, authUrl)).toBe(false);
  });

  it("fails closed when the Auth URL is invalid", () => {
    expect(isValidCallbackUrl("/account", "invalid")).toBe(false);
  });

  it("rejects a non-HTTP Auth URL even when the callback origin matches", () => {
    expect(isValidCallbackUrl(`${authUrl}/account`, `blob:${authUrl}/id`)).toBe(
      false,
    );
  });
});
