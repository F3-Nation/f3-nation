import { describe, expect, it } from "vitest";

import { DEV_MODE_CHANNELS } from "@acme/shared/common/dev-mode";

import { shouldShowDevModeSignIn } from "~/utils/dev-mode-sign-in";

describe("shouldShowDevModeSignIn", () => {
  it.each([...DEV_MODE_CHANNELS])(
    "shows on the %s channel once runtime config has loaded",
    (channel) => {
      expect(shouldShowDevModeSignIn({ channel, status: "ready" })).toBe(true);
    },
  );

  it.each(["prod", "", "Prod", "production", "unknown"])(
    "never shows on %j",
    (channel) => {
      expect(shouldShowDevModeSignIn({ channel, status: "ready" })).toBe(false);
    },
  );

  it.each(["loading", "error"] as const)(
    "stays hidden while runtime config is %s (its loading default is local)",
    (status) => {
      expect(shouldShowDevModeSignIn({ channel: "local", status })).toBe(false);
    },
  );
});
