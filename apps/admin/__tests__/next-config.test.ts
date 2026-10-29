// @vitest-environment node
// Loads this app's real Next config and checks it opts into the shared
// security headers. Lives in the app so a config-only change reruns it.
// Nothing embeds this app, so it must refuse to be framed.
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import type { NextConfigLike } from "@acme/security-headers/testing";
import { nextSecurityHeaderProblems } from "@acme/security-headers/testing";

it("sets the baseline security headers", async () => {
  const path = fileURLToPath(new URL("../next.config.js", import.meta.url));
  const config = ((await import(path)) as { default: NextConfigLike }).default;

  expect(
    await nextSecurityHeaderProblems(config, { embeddable: false }),
  ).toEqual([]);
});
