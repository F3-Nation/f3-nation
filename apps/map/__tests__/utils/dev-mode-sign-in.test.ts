import { describe, expect, it } from "vitest";

import { shouldShowDevModeSignIn } from "~/utils/dev-mode-sign-in";

const base = {
  isProd: false,
  isDevelopment: false,
  channel: "staging",
  showDebug: false,
};

describe("shouldShowDevModeSignIn", () => {
  it("shows on a per-PR preview (production build, branch channel)", () => {
    expect(shouldShowDevModeSignIn({ ...base, channel: "branch" })).toBe(true);
  });

  it("shows in local dev", () => {
    expect(
      shouldShowDevModeSignIn({
        ...base,
        isDevelopment: true,
        channel: "local",
      }),
    ).toBe(true);
  });

  it("shows on staging only when debug is on", () => {
    expect(shouldShowDevModeSignIn(base)).toBe(false);
    expect(shouldShowDevModeSignIn({ ...base, showDebug: true })).toBe(true);
  });

  it("never shows in prod, even with every other signal set", () => {
    expect(
      shouldShowDevModeSignIn({
        isProd: true,
        isDevelopment: true,
        channel: "branch",
        showDebug: true,
      }),
    ).toBe(false);
  });
});
