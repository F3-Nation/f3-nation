// Wiring check: each app's real Next config must opt into the shared headers
// with the framing policy this repo has decided on. Importing the configs also
// proves they still load.
//
// apps/homepage is deliberately absent: it is a static export (`output:
// "export"`) served from GitHub Pages, where Next's `headers()` does not apply
// and the host controls the response headers.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface Header {
  key: string;
  value: string;
}
interface AppConfig {
  poweredByHeader?: boolean;
  headers?: () => Promise<{ source: string; headers: Header[] }[]>;
}

const APPS = [
  { name: "admin", file: "next.config.js", embeddable: false },
  { name: "auth", file: "next.config.js", embeddable: false },
  { name: "me", file: "next.config.ts", embeddable: false },
  // The map is intentionally iframed by third-party sites (apps/map/iframe-test.html).
  { name: "map", file: "next.config.js", embeddable: true },
] as const;

// Apps with no Next config to check here: analytics and slackbot are Python,
// homepage is a static export (see the top of this file), and the Hono API's
// middleware is tested in apps/api/__tests__/app.test.ts.
const NOT_NEXT_APPS = ["analytics", "api", "homepage", "slackbot"];

const previousSkipEnvValidation = process.env.SKIP_ENV_VALIDATION;
beforeAll(() => {
  // admin/map validate their env at import time.
  process.env.SKIP_ENV_VALIDATION = "1";
});
afterAll(() => {
  if (previousSkipEnvValidation === undefined) {
    delete process.env.SKIP_ENV_VALIDATION;
  } else {
    process.env.SKIP_ENV_VALIDATION = previousSkipEnvValidation;
  }
});

it("covers every app directory, so a new app cannot ship without a header check", () => {
  const appsDir = fileURLToPath(new URL("../../../apps", import.meta.url));
  const dirs = readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !NOT_NEXT_APPS.includes(name))
    .sort();
  expect(dirs).toEqual(APPS.map((app) => app.name).sort());
});

describe.each(APPS)("apps/$name next config", ({ name, file, embeddable }) => {
  it("sets the baseline security headers", async () => {
    const path = fileURLToPath(
      new URL(`../../../apps/${name}/${file}`, import.meta.url),
    );
    const config = ((await import(path)) as { default: AppConfig }).default;

    expect(config.poweredByHeader).toBe(false);
    const rules = await config.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/:path*");

    const h = Object.fromEntries(
      (rules?.[0]?.headers ?? []).map((x) => [x.key, x.value]),
    );
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+$/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");

    if (embeddable) {
      expect(h).not.toHaveProperty("X-Frame-Options");
      expect(h).not.toHaveProperty("Content-Security-Policy");
      expect(h["Permissions-Policy"]).toContain("geolocation=(self)");
    } else {
      expect(h["X-Frame-Options"]).toBe("DENY");
      expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
      expect(h["Permissions-Policy"]).toContain("geolocation=()");
    }
  });
});
