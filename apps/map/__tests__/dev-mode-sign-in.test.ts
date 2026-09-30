import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevModeSignInAllowed } from "@acme/auth/lib/dev-mode";

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

  it.each(["", "Prod", "production", "unknown"])(
    "fails closed for %j",
    (channel) => {
      expect(isDevModeSignInAllowed(channel)).toBe(false);
    },
  );

  // An explicit `undefined` argument falls through to the F3_CHANNEL default.
  it("fails closed when F3_CHANNEL is unset", () => {
    vi.stubEnv("F3_CHANNEL", undefined);
    expect(isDevModeSignInAllowed()).toBe(false);
  });

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

describe("dev-mode provider registration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const registeredProviderIds = async () => {
    vi.resetModules();
    // @acme/env validates the full server env on import; config.ts pulls it in
    // through the db client.
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    const { authConfig } = await import("@acme/auth/config");
    return authConfig.providers.map((p) => {
      const provider = typeof p === "function" ? p() : p;
      // Credentials providers report a generic id; the configured one is in options.
      return (
        (provider as { options?: { id?: string } }).options?.id ?? provider.id
      );
    });
  };

  it("registers dev-mode on staging", async () => {
    vi.stubEnv("F3_CHANNEL", "staging");
    expect(await registeredProviderIds()).toContain("dev-mode");
  });

  it.each(["prod", "unknown"])("omits dev-mode on %s", async (channel) => {
    vi.stubEnv("F3_CHANNEL", channel);
    expect(await registeredProviderIds()).not.toContain("dev-mode");
  });

  it("omits dev-mode when F3_CHANNEL is unset", async () => {
    vi.stubEnv("F3_CHANNEL", undefined);
    expect(await registeredProviderIds()).not.toContain("dev-mode");
  });
});
