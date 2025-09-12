import type { PlaywrightTestConfig } from "@playwright/test";

import baseConfig from "./playwright.config";

const config: PlaywrightTestConfig = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: "https://staging.map.f3nation.com",
  },
  // Don't start a web server for staging tests
  webServer: undefined,
};

export default config;
