import type { BrowserContext, Page } from "@playwright/test";

export const testLogger = (context: string) => ({
  log: (action: string, data?: Record<string, unknown>) => {
    console.log(context, {
      action,
      ...data,
    });
  },
});

export const waitForMap = async (page: Page, timeout = 10000) => {
  const logger = testLogger("waitForMap");
  logger.log("Waiting for map to load");

  try {
    await page.waitForSelector('[aria-label="Map"]', {
      timeout,
      state: "visible",
    });
    logger.log("Map loaded successfully");
  } catch (error) {
    logger.log("Map failed to load", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const setupTestEnvironment = async (
  page: Page,
  context: BrowserContext,
) => {
  const logger = testLogger("setupTestEnvironment");
  logger.log("Setting up test environment");

  // Grant location permissions
  await context.grantPermissions(["geolocation"]);
};

export const setupAdminTestEnvironment = async (page: Page) => {
  await page.goto("/?lat=36.211104&lng=-81.660849&zoom=3");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign in (Dev Mode)" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Close" }).click();
};

export const teardownTestEnvironment = async (context: BrowserContext) => {
  const logger = testLogger("teardownTestEnvironment");
  logger.log("Tearing down test environment");

  // Stop tracing and save it
  await context.tracing.stop({ path: "test-results/trace.zip" });
};

export const setStore = async (
  page: Page,
  store: "map-store",
  value: Record<string, unknown>,
) => {
  await page.addInitScript(`
    window.localStorage.setItem('${store}', JSON.stringify(${JSON.stringify(value)}));
  `);
};
