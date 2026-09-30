import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevModeSignInAllowed } from "./dev-mode";

describe("isDevModeSignInAllowed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["local", "ci", "branch", "dev", "staging"])(
    "allows the %s channel",
    (channel) => {
      expect(isDevModeSignInAllowed(channel)).toBe(true);
    },
  );

  it("never allows the prod channel", () => {
    expect(isDevModeSignInAllowed("prod")).toBe(false);
  });

  it.each([undefined, "", "Prod", "production", "unknown"])(
    "fails closed for %j",
    (channel) => {
      expect(isDevModeSignInAllowed(channel)).toBe(false);
    },
  );

  it("reads F3_CHANNEL at call time", () => {
    vi.stubEnv("F3_CHANNEL", "prod");
    expect(isDevModeSignInAllowed()).toBe(false);

    vi.stubEnv("F3_CHANNEL", "staging");
    expect(isDevModeSignInAllowed()).toBe(true);
  });

  it("ignores NEXT_PUBLIC_CHANNEL", () => {
    vi.stubEnv("F3_CHANNEL", "prod");
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "staging");
    expect(isDevModeSignInAllowed()).toBe(false);
  });
});
