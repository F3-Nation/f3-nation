import { expect, test } from "@playwright/test";

import { TestId } from "@acme/shared/common/enums";

import { setupAdminTestEnvironment } from "./helpers";

test.describe("Manage Event Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await setupAdminTestEnvironment(page);
  });

  test("Find test AO if it exists and delete it", async ({ page }) => {
    const mapSearchboxInput = page.getByTestId(TestId.MAP_SEARCHBOX_INPUT);
    await mapSearchboxInput.click();
    await mapSearchboxInput.fill("Test event");
    await page.waitForTimeout(2000);

    const searchResults = page.getByTestId(
      TestId.MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP,
    );
    const testAoButton = searchResults.getByRole("button").nth(0);
    const testAoButtonText = await testAoButton.textContent();
    console.log("testAoButtonText", testAoButtonText);
    if (
      !testAoButtonText?.toLowerCase().includes("test event") ||
      !testAoButtonText?.toLowerCase().includes("workout")
    ) {
      console.log("Exiting: testAoButtonText", testAoButtonText);
      return;
    }
    await testAoButton.click();
    const selectedItem = page.getByTestId(TestId.SELECTED_ITEM_DESKTOP);
    await expect(selectedItem).toBeVisible();
    await expect(selectedItem).toContainText("Test event", {
      ignoreCase: true,
    });
    await selectedItem.click();

    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Test event", {
      ignoreCase: true,
    });

    const deleteButton = page
      .getByRole("button", { name: "Delete Workout" })
      .first();
    await deleteButton.click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(500);
  });

  test("should create a new location", async ({ page }) => {
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };

    await page.mouse.click(width / 2, height / 2);
    const updatePaneMarker = page.getByTestId(TestId.UPDATE_PANE_MARKER);
    await expect(updatePaneMarker).toBeVisible();
    await updatePaneMarker.click();
    await page.getByRole("button", { name: "(DEV) Load Test Data" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page
      .locator("div")
      .filter({ hasText: /^SelectRegion is required$/ })
      .getByRole("combobox")
      .click();

    await page.keyboard.type("Boone");
    await page
      .getByRole("option", { name: "Boone" })
      .locator("div")
      .first()
      .click();
    await page.waitForTimeout(200);
    await page
      .locator("div")
      .filter({
        hasText:
          /^SelectSelect a location above to move this workout to a different location$/,
      })
      .getByRole("combobox")
      .click();
    await page
      .getByRole("combobox")
      .filter({ hasText: "Select" })
      .first()
      .click();

    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(500);

    const mapSearchboxInput = page.getByTestId(TestId.MAP_SEARCHBOX_INPUT);
    await mapSearchboxInput.click();
    await mapSearchboxInput.fill("test event");

    await page.getByRole("button", { name: "item Test Event Workout" }).click();
    const selectedItem = page.getByTestId(TestId.SELECTED_ITEM_DESKTOP);
    await expect(selectedItem).toBeVisible();
    await expect(selectedItem).toContainText("Test Event");
    await selectedItem.click();

    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Test Event");

    const editButton = page
      .getByRole("button", { name: "Edit Workout" })
      .first();
    await editButton.click();
    await page.locator('input[name="eventName"]').click();
    await page.locator('input[name="eventName"]').fill("Test Event 1234");
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000); // wait for the map to update

    // await mapSearchboxInput.click();
    // await mapSearchboxInput.fill("test event 1234");
    // await page.getByRole("button", { name: "item Test Event Workout" }).click();
  });
});
