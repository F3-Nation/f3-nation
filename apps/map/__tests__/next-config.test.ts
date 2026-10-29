// @vitest-environment node
// Loads this app's real Next config and checks it opts into the shared
// security headers. Lives in the app so a config-only change reruns it.
// The map is intentionally iframed by third-party sites
// (apps/map/iframe-test.html), so it must send no framing header and keeps
// `geolocation=(self)`.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { NextConfigLike } from "@acme/security-headers/testing";
import { nextSecurityHeaderProblems } from "@acme/security-headers/testing";

beforeAll(() => {
  // The config validates env at import time.
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

it("sets the baseline security headers", async () => {
  const path = fileURLToPath(new URL("../next.config.js", import.meta.url));
  const config = ((await import(path)) as { default: NextConfigLike }).default;

  expect(
    await nextSecurityHeaderProblems(config, { embeddable: true }),
  ).toEqual([]);
});
