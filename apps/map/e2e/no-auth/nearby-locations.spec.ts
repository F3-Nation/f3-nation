import { expect, test } from "@playwright/test";

import { TestId } from "@acme/shared/common/enums";

// Test: Search for 'TEST EVENT' in the search bar

const prefix = "EDIT TEST";

test("searches for TEST EVENT in the search bar", async ({ page }) => {
  // Navigate to the site
  await page.goto("http://localhost:3000");

  // Click the search bar (try common selectors)

  // Search and open the created item
  const mapSearchboxInput = page.getByTestId(TestId.MAP_SEARCHBOX_INPUT);
  await mapSearchboxInput.click();
  await mapSearchboxInput.fill(prefix);
  await page.waitForTimeout(2000);
  const searchResult = page
    .getByRole("button", {
      name: `item ${prefix} Event Workout (F3 Boone)`,
      exact: true,
    })
    .first();
  await expect(searchResult).toBeVisible({ timeout: 10000 });
  await searchResult.click();
  await page.waitForTimeout(1000);

  // await page.setViewportSize({ width: 1280, height: 720 });

  const selectedItem = page.getByTestId(TestId.SELECTED_ITEM_DESKTOP);
  await expect(selectedItem).toBeVisible({ timeout: 5000 });
  await selectedItem.click();
  await page.waitForTimeout(1000);
  const panel = page.getByTestId(TestId.PANEL);
  await expect(panel).toBeVisible({ timeout: 5000 });
  await expect(panel).toContainText(`${prefix} AO`, { timeout: 5000 });
  await expect(panel).toContainText(`${prefix} EVENT`, { timeout: 5000 });
});
