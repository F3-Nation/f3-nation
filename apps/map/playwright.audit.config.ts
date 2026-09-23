import { createBaseConfig } from "@acme/playwright-config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...createBaseConfig(),
  globalSetup: undefined,
  outputDir: "node_modules/.cache/audit-e2e/test-results",
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "node_modules/.cache/audit-e2e/report" },
    ],
  ],
  retries: 0,
  projects: [
    {
      name: "audit-local",
      testMatch: "**/tests/e2e-advisory/audit-history.spec.ts",
    },
  ],
});
