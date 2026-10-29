#!/usr/bin/env node
// Fails when a Next app under apps/ has no `__tests__/next-config.test.ts`
// calling `nextSecurityHeaderProblems` from `@acme/security-headers/testing`.
// Runs from `pnpm lint` on every change, because CI runs tests only for
// affected workspaces: a newly added app would otherwise never be checked.
//
// Static exports (`output: "export"`, today apps/homepage on GitHub Pages) are
// skipped: Next's `headers()` does not apply to them and the host controls the
// response headers. Apps without a Next config (analytics and slackbot are
// Python, the Hono API tests its middleware in apps/api) are skipped too.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const CONFIG_NAMES = ["next.config.js", "next.config.mjs", "next.config.ts"];
const TEST_PATH = join("__tests__", "next-config.test.ts");
const STATIC_EXPORT = /output\s*:\s*["']export["']/;

const missing = readdirSync("apps", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const dir = join("apps", entry.name);
    const config = CONFIG_NAMES.map((name) => join(dir, name)).find((path) =>
      existsSync(path),
    );
    if (!config || STATIC_EXPORT.test(readFileSync(config, "utf8"))) return [];
    const test = join(dir, TEST_PATH);
    const covered =
      existsSync(test) &&
      readFileSync(test, "utf8").includes("nextSecurityHeaderProblems");
    return covered ? [] : [dir];
  });

if (missing.length > 0) {
  process.stderr.write(
    `Next apps with no security-header check (add ${TEST_PATH} calling ` +
      `nextSecurityHeaderProblems from @acme/security-headers/testing):\n` +
      missing.map((dir) => `  ${dir}\n`).join(""),
  );
  process.exit(1);
}
