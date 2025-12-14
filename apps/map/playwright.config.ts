import type { PlaywrightTestConfig } from "@playwright/test";
import { devices } from "@playwright/test";

// TODO: Better separation of auth and no auth tests

const config: PlaywrightTestConfig = {
  testDir: "./e2e",
  timeout: 120000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    permissions: ["geolocation"],
  },
  webServer: {
    command: "pnpm -F nextjs dev",
    port: 3000,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  retries: 1,
  projects: [
    { name: "setup", testMatch: /setup\/.+\.spec\.ts/ },
    {
      name: "chromium with auth",
      testMatch: /auth\/.+\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Use prepared auth state.
        storageState: "./e2e/setup/.auth/user.json",
      },
      // Only run this if we need to reauthenticate
      // dependencies: ["setup"],
    },
    // {
    //   name: "chromium no auth",
    //   testMatch: /.*-no-auth\.spec\.ts/,
    //   use: {
    //     ...devices["Desktop Chrome"],
    //   },
    // },
    // {
    //   name: "chromium with auth",
    //   testMatch: /.*-auth\.spec\.ts/,
    //   use: {
    //     ...devices["Desktop Chrome"],
    //     // Use prepared auth state.
    //     storageState: "./e2e/.auth/user.json",
    //   },
    //   dependencies: ["setup"],
    // },
  ],
};

export default config;
