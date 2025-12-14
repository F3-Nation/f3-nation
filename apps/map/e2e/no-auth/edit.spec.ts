import path from "path";
import { expect, test } from "@playwright/test";

import { SIDEBAR_WIDTH } from "@acme/shared/app/constants";
// TODO: Remove all wait for timeouts

import { TestId } from "@acme/shared/common/enums";

import { turnOnEditMode } from "../helpers";

const prefix = "EDIT FLOW";

/**
 * This test covers all map actions for admin: create, move, edit, add, and move event/AO.
 */
test.describe("Admin Map Actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?lat=31.659308&lng=-132.955330&zoom=8");
    await turnOnEditMode(page);
    await page.waitForSelector('[aria-label="Map"]', { timeout: 30000 });
  });

  test("New location, AO, & event", async ({ page }) => {
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };
    await page.mouse.click(
      (width - SIDEBAR_WIDTH) / 2 + SIDEBAR_WIDTH,
      height / 2,
    );
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible({
      timeout: 2000,
    });
    await page
      .getByRole("button", { name: "New location, AO, & event", exact: true })
      .click();
    await expect(page.getByText("New Location, AO, & Event")).toBeVisible({
      timeout: 2000,
    });
    await page.getByRole("combobox").first().click();
    await expect(
      page
        .getByRole("dialog", { name: "New Location, AO & Event" })
        .getByText("Boone"),
    ).toBeVisible({ timeout: 2000 });
    await page.keyboard.type("Boone");
    await expect(page.getByRole("option", { name: "Boone" })).toBeVisible({
      timeout: 2000,
    });
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.locator('input[name="locationAddress"]').fill("100 Test St");
    await page.locator('input[name="locationCity"]').fill("Testville");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("11111");
    await page.locator("#locationCountry").click();
    await page.getByRole("option", { name: "United States" }).click();

    // Get the existing lat and lng values from the inputs
    const latInput = page.locator('input[name="locationLat"]');
    const lngInput = page.locator('input[name="locationLng"]');
    const latValueStr = await latInput.inputValue();
    const lngValueStr = await lngInput.inputValue();
    const latValue = parseFloat(latValueStr);
    const lngValue = parseFloat(lngValueStr);
    const newLat = (isNaN(latValue) ? 0 : latValue) + 2;
    const newLng = (isNaN(lngValue) ? 0 : lngValue) + 2;
    await latInput.fill(newLat.toString());
    await lngInput.fill(newLng.toString());

    await page
      .locator('textarea[name="locationDescription"]')
      .fill("First test location");
    await page.getByText("AO Details:").scrollIntoViewIfNeeded();
    await page.locator('input[name="aoName"]').fill(`${prefix} AO1`);
    await page.locator('input[name="aoWebsite"]').fill("https://ao1.com");
    const filePath = path.resolve(process.cwd(), "e2e/tests/image.png");
    await page.locator('input[type="file"]').setInputFiles(filePath);
    await page.getByText("Event Details:").scrollIntoViewIfNeeded();
    await page.locator('input[name="eventName"]').fill(`${prefix} EVENT1`);
    await page.locator("#eventDayOfWeek").click();
    await page.getByRole("option", { name: "Monday" }).click();
    await page.locator("#eventStartTime").click();
    await page.keyboard.type("0600A");
    await page.locator("#eventEndTime").click();
    await page.keyboard.type("0700A");
    await page.getByRole("button", { name: "Select event types" }).click();
    await page.getByRole("option").first().click();
    await page
      .locator('textarea[name="eventDescription"]')
      .fill("First event description");
    await page.getByText("Contact Information:").scrollIntoViewIfNeeded();
    await page.locator('input[name="submittedBy"]').fill("admin1@example.com");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Move existing AO here", async ({ page }) => {
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };
    await page.mouse.click(width / 2 + 50, height / 2 + 50);
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible({
      timeout: 2000,
    });
    await page
      .getByRole("button", { name: "Move existing AO here", exact: true })
      .click();
    await page.waitForTimeout(500);
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.getByRole("combobox").nth(1).click();
    await page.keyboard.type(`${prefix} AO1`);
    await page.waitForTimeout(500);
    await page
      .getByRole("option", { name: `${prefix} AO1` })
      .first()
      .click();
    await page.locator('input[name="locationAddress"]').fill("200 Test St");
    await page.locator('input[name="locationCity"]').fill("Moved City");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("22222");
    await page.locator("#locationCountry").click();
    await page.getByRole("option", { name: "United States" }).click();
    await page
      .locator('textarea[name="locationDescription"]')
      .fill("Moved AO location");

    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Edit AO details", async ({ page }) => {
    // Open AO panel
    const aoButton = page
      .getByRole("button", { name: `${prefix} AO1` })
      .first();
    await expect(aoButton).toBeVisible({ timeout: 10000 });
    await aoButton.click();
    await page.waitForTimeout(1000);
    // Open edit dropdown
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 1000 });
    // Click Edit AO details
    await page.getByRole("button", { name: "Edit AO:" }).first().click();
    await page
      .getByRole("menuitem", { name: "Edit AO details" })
      .first()
      .click();
    await page.locator('input[name="aoName"]').fill(`${prefix} AO1 Updated`);
    await page
      .locator('input[name="aoWebsite"]')
      .fill("https://ao1-updated.com");
    const filePath = path.resolve(process.cwd(), "e2e/tests/image.png");
    await page.locator('input[type="file"]').setInputFiles(filePath);
    await page.locator('input[name="locationAddress"]').fill("201 Test St");
    await page.locator('input[name="locationCity"]').fill("Updated City");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("33333");
    await page.locator("#locationCountry").click();
    await page.getByRole("option", { name: "Mexico" }).click();
    await page
      .locator('textarea[name="locationDescription"]')
      .fill("Updated AO location");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Move to different region", async ({ page }) => {
    // Open AO panel
    const aoButton = page
      .getByRole("button", { name: `${prefix} AO1 Updated` })
      .first();
    await expect(aoButton).toBeVisible({ timeout: 10000 });
    await aoButton.click();
    await page.waitForTimeout(1000);
    // Open edit dropdown
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 1000 });
    await page.getByRole("button", { name: "Edit AO:" }).first().click();
    // Click Move to different region
    await page
      .getByRole("menuitem", { name: "Move to different region" })
      .click();
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Charlotte");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Charlotte" }).first().click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Edit workout details", async ({ page }) => {
    // Open AO panel and select event
    const aoButton = page
      .getByRole("button", { name: `${prefix} AO1 Updated` })
      .first();
    await expect(aoButton).toBeVisible({ timeout: 10000 });
    await aoButton.click();
    await page.waitForTimeout(1000);
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 1000 });

    const eventButton = page
      .getByRole("button", { name: `${prefix} EVENT1` })
      .first();
    await expect(eventButton).toBeVisible({ timeout: 10000 });
    await eventButton.click();
    await page.waitForTimeout(1000);
    // Open edit dropdown
    // Click Edit workout details
    await page.getByRole("menuitem", { name: "Edit workout details" }).click();
    await page
      .locator('input[name="eventName"]')
      .fill(`${prefix} EVENT1 Updated`);
    await page.locator("#eventDayOfWeek").click();
    await page.getByRole("option", { name: "Friday" }).click();
    await page.locator("#eventStartTime").click();
    await page.keyboard.type("0630A");
    await page.locator("#eventEndTime").click();
    await page.keyboard.type("0730A");
    await page
      .locator(
        'div:has-text("Event Types") ~ div button[aria-haspopup="dialog"]',
      )
      .click();
    await page.getByRole("option").nth(1).click();
    await page
      .locator('textarea[name="eventDescription"]')
      .fill("Updated event description");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("New location, AO, & event (2)", async ({ page }) => {
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };
    await page.mouse.click(width / 2 - 50, height / 2 - 50);
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible({
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: "New location, AO, & event", exact: true })
      .click();
    await page.waitForTimeout(500);
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.locator('input[name="locationAddress"]').fill("300 Test St");
    await page.locator('input[name="locationCity"]').fill("Testopolis");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("44444");
    await page
      .locator('textarea[name="locationDescription"]')
      .fill("Second test location");
    await page.getByText("AO Details:").scrollIntoViewIfNeeded();
    await page.locator('input[name="aoName"]').fill(`${prefix} AO2`);
    await page.locator('input[name="aoWebsite"]').fill("https://ao2.com");
    const filePath = path.resolve(process.cwd(), "e2e/tests/image.png");
    await page.locator('input[type="file"]').setInputFiles(filePath);
    await page.getByText("Event Details:").scrollIntoViewIfNeeded();
    await page.locator('input[name="eventName"]').fill(`${prefix} EVENT2`);
    await page.locator("#eventDayOfWeek").click();
    await page.getByRole("option", { name: "Tuesday" }).click();
    await page.locator("#eventStartTime").click();
    await page.keyboard.type("0600A");
    await page.locator("#eventEndTime").click();
    await page.keyboard.type("0700A");
    await page.getByRole("button", { name: "Select event types" }).click();
    await page.getByRole("option").first().click();
    await page
      .locator('textarea[name="eventDescription"]')
      .fill("Second event description");
    await page.getByText("Contact Information:").scrollIntoViewIfNeeded();
    await page.locator('input[name="submittedBy"]').fill("admin2@example.com");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Add workout", async ({ page }) => {
    // Open AO2 panel
    const aoButton = page
      .getByRole("button", { name: `${prefix} AO2` })
      .first();
    await expect(aoButton).toBeVisible({ timeout: 10000 });
    await aoButton.click();
    await page.waitForTimeout(1000);
    // Click Add Workout to AO
    await page.getByRole("button", { name: "Add Workout to AO" }).click();
    await page.locator('input[name="eventName"]').fill(`${prefix} EVENT3`);
    await page.locator("#eventDayOfWeek").click();
    await page.getByRole("option", { name: "Wednesday" }).click();
    await page.locator("#eventStartTime").click();
    await page.keyboard.type("0600A");
    await page.locator("#eventEndTime").click();
    await page.keyboard.type("0700A");
    await page.getByRole("button", { name: "Select event types" }).click();
    await page.getByRole("option").first().click();
    await page
      .locator('textarea[name="eventDescription"]')
      .fill("Third event description");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Move to different AO", async ({ page }) => {
    // Open AO2 panel and select event
    const aoButton = page
      .getByRole("button", { name: `${prefix} AO2` })
      .first();
    await expect(aoButton).toBeVisible({ timeout: 10000 });
    await aoButton.click();
    await page.waitForTimeout(1000);
    const eventButton = page
      // .getByRole("button", { name: `${prefix} EVENT3` })
      .getByText("Wednesday 6AM - 7AM (60min)")
      .first();
    await expect(eventButton).toBeVisible({ timeout: 10000 });
    await eventButton.click();

    const editButton = page
      .getByRole("button", { name: `Edit Workout: ${prefix} EVENT3` })
      .first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // Open edit dropdown
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 1000 });

    // Click Move to different AO
    await page.getByRole("menuitem", { name: "Move to different AO" }).click();
    await page.getByRole("combobox").first().click();
    await page.getByPlaceholder("Select Region").click();
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByPlaceholder("Select AO").click();
    await page.keyboard.type(`${prefix} AO1 Updated`);
    await page.waitForTimeout(500);
    await page
      .getByRole("option", { name: `${prefix} AO1 Updated (Boone)` })
      .first()
      .click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("Move existing event here", async ({ page }) => {
    const mapContainer = await page.$('[aria-label="Map"]');
    const { width, height } = (await mapContainer?.boundingBox()) ?? {
      width: 0,
      height: 0,
    };
    await page.mouse.click(width / 2 + 100, height / 2 + 100);
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible({
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: "Move existing event here", exact: true })
      .click();
    await page.waitForTimeout(500);
    await page.getByRole("combobox").first().click();
    await page.keyboard.type("Boone");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Boone" }).first().click();
    await page.getByRole("combobox").nth(1).click();
    await page.keyboard.type(`${prefix} AO2 (Boone)`);
    await page.waitForTimeout(500);
    await page
      .getByRole("option", { name: `${prefix} AO2 (Boone)` })
      .first()
      .click();
    await page.getByRole("combobox").nth(2).click();
    await page.keyboard.type(`${prefix} EVENT2`);
    await page.waitForTimeout(500);
    await page
      .getByRole("option", { name: `${prefix} EVENT2` })
      .first()
      .click();
    await page.locator('input[name="locationAddress"]').fill("400 Test St");
    await page.locator('input[name="locationCity"]').fill("EventMoved City");
    await page.locator('input[name="locationState"]').fill("NC");
    await page.locator('input[name="locationZip"]').fill("55555");
    await page
      .locator('textarea[name="locationDescription"]')
      .fill("Event moved location");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await page.waitForTimeout(2000);
    // Ensure the update modal closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
  });

  test("CLEANUP: delete created AOs", async ({ page }) => {
    const maxAttempts = 10;
    let attempt = 0;
    while (attempt < maxAttempts) {
      await page.reload();
      await page.waitForTimeout(1000); // Give time for page to load
      // Find all AO buttons with the prefix in their name
      const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
      const aoButtons = await nearbyLocations.locator("button").all();
      const aoButtonsWithPrefix = [];
      for (const btn of aoButtons) {
        const name = await btn.textContent();
        if (name?.includes(prefix)) {
          aoButtonsWithPrefix.push(btn);
        }
      }
      if (aoButtonsWithPrefix.length === 0) {
        break;
      }
      for (const aoButton of aoButtonsWithPrefix) {
        if (await aoButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await aoButton.click();
          // Open edit dropdown
          // wait until the edit button is visible
          const editButton = page
            .getByRole("button", { name: "Edit AO:" })
            .first();
          await editButton.waitFor({ state: "visible", timeout: 1000 });
          await editButton.click();
          // Click Delete AO
          const deleteMenuItem = page
            .getByRole("menuitem", { name: "Delete this AO", exact: true })
            .first();
          if (
            await deleteMenuItem.isVisible({ timeout: 1000 }).catch(() => false)
          ) {
            await deleteMenuItem.click();
            // Confirm deletion in modal/dialog
            const confirmButton = page
              .getByRole("button", { name: /Delete|Confirm/i })
              .first();
            if (
              await confirmButton
                .isVisible({ timeout: 1000 })
                .catch(() => false)
            ) {
              await confirmButton.click();
              await page.waitForTimeout(1000);
            }
          }
        }
      }
      attempt++;
    }
  });
});

// TODO: test deleting a workout first. then delete an AO
