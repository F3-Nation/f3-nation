import { defineConfig } from "@playwright/test";

// End-to-end tests run against a local dev server wired to the local
// dockerized Postgres. The export is written to a temp file (never GCS).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "postgres://postgres:devpass@localhost:5433/f3redirect",
      EXPORT_LOCAL_PATH: "/tmp/pw-redirects.json",
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
      BETTER_AUTH_URL: "http://localhost:3000",
      CONFIG_BUCKET: "test-bucket",
      REDIRECT_STATIC_IP: "34.172.36.60",
    },
  },
});
