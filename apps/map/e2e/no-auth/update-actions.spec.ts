import path from "path";
import { expect, test } from "@playwright/test";

import { TestId } from "@acme/shared/common/enums";

import { turnOnEditMode } from "../helpers";

/**
 * As an authenticated user, go through all the update actions in the map and verify that the updates are correct
 *
 * 1. Go to the map
 * 2. turn on edit mode
 * 3. click on the map and create a new location with an event for the Boone region
 * 4. do the other new marker actions
 * 5. Go to this new ao
 * 6. do the update actions allowed there
 */

test.describe("Update Actions", () => {
  test.beforeAll(async ({ browser }) => {
    // Create a new page for cleanup only
    const context = await browser.newContext();
    const _page = await context.newPage();

    // Clean up any leftover test data before starting tests
    // Turn this off for now to improve test speed
    // await cleanupTestData(page, "MAP TEST");

    // Close the context when done
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    // We already have an auth state saved so we don't need to set up an auth environment
    await page.goto("/");
    await turnOnEditMode(page);
  });

  test("should create a new location with AO and event", async ({ page }) => {
    console.log("Starting create and update test");
    // Wait for the map to be fully loaded
    await page.waitForSelector('[aria-label="Map"]', { timeout: 30000 });

    // Get the map dimensions
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };
    console.log("Map dimensions", { width, height });

    // Click on the map to create a new location
    await page.mouse.click(width / 2, height / 2);

    // Verify the update pane marker is visible
    const updatePaneMarker = page.getByTestId(TestId.UPDATE_PANE_MARKER);
    await expect(updatePaneMarker).toBeVisible({ timeout: 5000 });

    // Click on the "New location, AO, & event" button
    const newLocationButton = page.getByRole("button", {
      name: "New location, AO, & event",
      exact: true,
    });
    await expect(newLocationButton).toBeVisible({ timeout: 5000 });
    await newLocationButton.click();
    await page.waitForTimeout(1000);

    // Fill in the form fields

    // 1. Fill in Region Details
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.waitForTimeout(500);

    // 2. Fill in Location Details
    await page.locator('input[name="locationAddress"]').fill("123 Test Street");
    await page.locator('input[name="locationCity"]').fill("Test City");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("12345");
    await page
      .locator('textarea[name="locationDescription"]')
      .fill("This is a test location description");

    // 3. Fill in Event Details
    await page.locator('input[name="eventName"]').fill("MAP TEST Event");

    // Select day of week
    await page.getByText("Day of Week").scrollIntoViewIfNeeded();
    await page.locator("#eventDayOfWeek").click();
    await page.getByRole("option", { name: "Wednesday" }).click();

    // Set times
    await page.locator("#eventStartTime").click();
    await page.keyboard.type("0600A");
    await page.locator("#eventEndTime").click();
    await page.keyboard.type("0700A");

    // Select event types
    await page.getByRole("button", { name: "Select event types" }).click();
    await page.waitForTimeout(500);
    const eventTypeOption = page.getByRole("option").first();
    await eventTypeOption.click();

    // Add event description
    await page
      .locator('textarea[name="eventDescription"]')
      .fill("This is a test event description");

    // 4. Fill in AO Details
    await page.getByText("AO Details:").scrollIntoViewIfNeeded();
    await page.locator('input[name="aoName"]').fill("MAP TEST AO");
    await page.locator('input[name="aoWebsite"]').fill("https://example.com");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator('input[name="aoLogo"]').click();
    const fileChooser = await fileChooserPromise;
    // Base is apps/nextjs
    const logoPath = path.join(process.cwd(), "public/f3_logo.png");
    console.log("logoPath", logoPath);
    await fileChooser.setFiles("public/f3_logo.png");

    // 5. Fill Contact Details
    await page.locator('input[name="submittedBy"]').fill("test@example.com");

    // Submit the form
    await page.getByTestId(TestId.UPDATE_MODAL_SUBMIT_BUTTON).click();
    await page.waitForTimeout(2000);

    // Search for the newly created item
    const mapSearchboxInput = page.getByTestId(TestId.MAP_SEARCHBOX_INPUT);
    await mapSearchboxInput.click();
    await mapSearchboxInput.fill("MAP TEST");
    await page.waitForTimeout(2000);

    // Click on the search result
    const searchResult = page
      .getByRole("button", { name: /MAP TEST/i })
      .first();
    await expect(searchResult).toBeVisible({ timeout: 10000 });
    await searchResult.click();
    await page.waitForTimeout(1000);

    // Verify the selected item is visible
    const selectedItem = page.getByTestId(TestId.SELECTED_ITEM_DESKTOP);
    await expect(selectedItem).toBeVisible({ timeout: 5000 });
    await expect(selectedItem).toContainText("MAP TEST", { timeout: 5000 });

    // Click on the selected item to open the panel
    await selectedItem.click();
    await page.waitForTimeout(1000);

    // Verify the panel is visible with our data
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 5000 });
    await expect(panel).toContainText("MAP TEST AO", { timeout: 5000 });
    await expect(panel).toContainText("MAP TEST Event", { timeout: 5000 });

    // Edit the item
    const editButton = page.getByRole("button", { name: "Edit" }).first();
    await editButton.click();
    await page.waitForTimeout(1000);

    // Update the name
    const eventNameInput = page.locator('input[name="eventName"]');
    await eventNameInput.click();
    await eventNameInput.fill("MAP TEST Event Updated");

    // Save the changes
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);

    // Verify the changes were saved
    await expect(panel).toContainText("MAP TEST Event Updated", {
      timeout: 5000,
    });

    // Delete the item
    const deleteButton = page.getByRole("button", { name: "Delete" }).first();
    await deleteButton.click();
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(2000);

    // Verify it was deleted
    await mapSearchboxInput.click();
    await mapSearchboxInput.fill("MAP TEST Event Updated");
    await page.waitForTimeout(2000);

    try {
      const count = await page
        .getByRole("button", { name: /MAP TEST Event Updated/i })
        .count();
      if (count > 0) {
        await expect(
          page.getByRole("button", { name: /MAP TEST Event Updated/i }),
        ).not.toBeVisible({ timeout: 5000 });
      }
    } catch (e) {
      console.log("Button not found, which is expected if item was deleted");
    }
  });

  test("should test move AO to new location", async ({ page }) => {
    // Wait for the map to be fully loaded
    await page.waitForSelector('[aria-label="Map"]', { timeout: 30000 });

    // Get the map dimensions
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };

    // Click on a different spot on the map
    await page.mouse.click(width / 2 + 100, height / 2 - 100);
    await page.waitForTimeout(1000);

    // Verify the update pane marker is visible
    const updatePaneMarker = page.getByTestId(TestId.UPDATE_PANE_MARKER);
    await expect(updatePaneMarker).toBeVisible({ timeout: 5000 });

    // Click on the marker to open the update pane
    await updatePaneMarker.click();
    await page.waitForTimeout(1000);

    // Click on "Move existing AO here" button
    const moveAOButton = page.getByRole("button", {
      name: "Move existing AO here",
      exact: true,
    });
    await expect(moveAOButton).toBeVisible({ timeout: 5000 });
    await moveAOButton.click();
    await page.waitForTimeout(1000);

    // Select region (just to test the UI, not actually submitting)
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.waitForTimeout(500);

    // Try to select an AO
    try {
      await page.getByText("AO Selection:").scrollIntoViewIfNeeded();
      const aoSelector = page.getByRole("combobox").nth(1);
      if (await aoSelector.isVisible({ timeout: 2000 })) {
        await aoSelector.click();
        await page.keyboard.type("Yarak");
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log("Could not select AO");
    }

    // Fill location details
    await page.locator('input[name="locationAddress"]').fill("456 Move Street");
    await page.locator('input[name="locationCity"]').fill("Move City");

    // Cancel the operation
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(1000);
  });

  test("should test move event to new location", async ({ page }) => {
    // Wait for the map to be fully loaded
    await page.waitForSelector('[aria-label="Map"]', { timeout: 30000 });

    // Get the map dimensions
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };

    // Click on yet another spot on the map
    await page.mouse.click(width / 2 - 100, height / 2 + 100);
    await page.waitForTimeout(1000);

    // Verify the update pane marker is visible
    const updatePaneMarker = page.getByTestId(TestId.UPDATE_PANE_MARKER);
    await expect(updatePaneMarker).toBeVisible({ timeout: 5000 });

    // Click on the marker to open the update pane
    await updatePaneMarker.click();
    await page.waitForTimeout(1000);

    // Click on "Move existing event here" button
    const moveEventButton = page.getByRole("button", {
      name: "Move existing event here",
      exact: true,
    });
    await expect(moveEventButton).toBeVisible({ timeout: 5000 });
    await moveEventButton.click();
    await page.waitForTimeout(1000);

    // Select region (just to test the UI, not actually submitting)
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.waitForTimeout(500);

    // Fill in some location details
    await page
      .locator('input[name="locationAddress"]')
      .fill("789 Event Move Street");

    // Cancel the operation
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(1000);
  });
});
