// @vitest-environment node
// Loads this app's real Next config and checks it meets the shared
// security-header baseline. Lives in the app so a config-only change reruns it.
// The app sends its own stricter policy (full CSP, longer HSTS); nothing embeds
// it, and its "near me" search needs `geolocation=(self)`.
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import type { NextConfigLike } from "@acme/security-headers/testing";
import { nextSecurityHeaderProblems } from "@acme/security-headers/testing";

it("meets the baseline security headers", async () => {
  const path = fileURLToPath(new URL("../next.config.ts", import.meta.url));
  const config = ((await import(path)) as { default: NextConfigLike }).default;

  expect(
    await nextSecurityHeaderProblems(config, {
      frame: "deny",
      geolocation: true,
    }),
  ).toEqual([]);
});
