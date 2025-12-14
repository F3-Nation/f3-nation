import { expect, test } from "@playwright/test";

import {
  addNewItemAndVerify,
  cleanupTestData,
  deleteItemAndVerify,
  editItemAndVerify,
  fillTimeInput,
  goToAdminPortal,
  goToSection,
} from "../helpers";

const prefix = "SUPER TEST";

// To run this file:
// 1. pnpm -F nextjs test:e2e:ui --grep="admin"
// 2. Commend out beforeAll cleanupTestData (~line 15) if running directly
test.describe("Admin Portal", () => {
  test.beforeAll(async ({ browser }) => {
    // Create a new page for cleanup only
    const context = await browser.newContext();
    const page = await context.newPage();

    // Clean up any leftover test data before starting tests
    await cleanupTestData({ page, prefix });

    // Close the context when done
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    // await setupAdminTestEnvironment(page);
    await goToAdminPortal(page);
  });

  test("go to Sectors and add a new Sector", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/);
    await goToSection(page, "Sectors");
    await addNewItemAndVerify({
      page,
      section: "Sector",
      extraSteps: async () => {
        await page.getByRole("combobox").filter({ hasText: /^$/ }).click();
        await page.getByRole("option", { name: "F3 Nation" }).click();
      },
      prefix,
    });
  });

  test("edit the new Sector", async ({ page }) => {
    await goToSection(page, "Sectors");
    await editItemAndVerify({
      page,
      name: "SECTOR",
      order: 2,
      prefix,
    });
  });

  test("go to Areas and add a new Area", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/);
    await goToSection(page, "Areas");
    await addNewItemAndVerify({
      page,
      section: "Area",
      extraSteps: async () => {
        await page.getByRole("combobox").filter({ hasText: /^$/ }).click();
        await page.getByRole("option", { name: "SUPER TEST SECTOR" }).click();
      },
      prefix,
    });
  });

  test("edit the new Area", async ({ page }) => {
    await goToSection(page, "Areas");
    await editItemAndVerify({
      page,
      name: "AREA",
      order: 2,
      prefix,
    });
  });

  test("go to Regions and add a new Region", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/);
    await goToSection(page, "Regions");
    await addNewItemAndVerify({
      page,
      section: "Region",
      extraSteps: async () => {
        await page.getByRole("combobox").filter({ hasText: /^$/ }).click();
        await page.getByRole("option", { name: `${prefix} AREA 2` }).click();
      },
      prefix,
    });
  });

  test("edit the new Region", async ({ page }) => {
    await goToSection(page, "Regions");
    await editItemAndVerify({
      page,
      name: "REGION",
      order: 2,
      prefix,
    });
  });

  test("go to AOs and add a new AO", async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/);
    await goToSection(page, "AOs");
    await addNewItemAndVerify({
      page,
      section: "AO",
      prefix,
      extraSteps: async () => {
        await page.getByRole("combobox").filter({ hasText: /^$/ }).click();
        await page.getByPlaceholder("Select a region").fill("super");
        await page
          .getByRole("option", { name: `${prefix} REGION 2` })
          .first()
          .click();
      },
    });
  });

  test("edit the new AO", async ({ page }) => {
    await goToSection(page, "AOs");
    await editItemAndVerify({
      page,
      name: "AO",
      order: 2,
      prefix,
    });
  });

  test("go to Event Types and add a new Event Type", async ({ page }) => {
    await goToSection(page, "Event Types");
    await addNewItemAndVerify({
      page,
      section: "Event Type",
      prefix,
      extraSteps: async () => {
        await page
          .locator('textarea[name="description"]')
          .fill("Test event type description");
        await page.getByRole("combobox", { name: "Event Category" }).click();
        await page.getByRole("option", { name: "1st F" }).click();
        await page
          .getByRole("combobox")
          .filter({ hasText: "Select a region" })
          .click();
        await page.getByPlaceholder("Select a region").fill("SUPER");
        await page
          .getByRole("option", { name: "SUPER TEST REGION 2" })
          .first()
          .click();
      },
    });
  });

  test("edit the new Event Type", async ({ page }) => {
    await goToSection(page, "Event Types");
    await editItemAndVerify({
      page,
      name: "EVENT TYPE",
      order: 2,
      prefix,
    });
  });

  test("go to Locations and add a new Location", async ({ page }) => {
    await goToSection(page, "Locations");
    await addNewItemAndVerify({
      page,
      section: "Location",
      prefix,
      extraSteps: async () => {
        await page
          .getByRole("textbox", { name: "Name" })
          .fill("SUPER TEST LOCATION");
        await page.waitForTimeout(250);
        await page
          .getByRole("combobox")
          .filter({ hasText: "Select a region" })
          .click();
        await page.getByPlaceholder("Select a region").fill(prefix);
        await page
          .getByRole("option", { name: `${prefix} REGION 2` })
          .first()
          .click();
      },
    });
  });

  test("edit the new Location", async ({ page }) => {
    await goToSection(page, "Locations");
    await editItemAndVerify({
      page,
      name: "LOCATION",
      order: 2,
      prefix,
    });
  });

  test("go to Events and add a new Event", async ({ page }) => {
    await goToSection(page, "Events");
    await addNewItemAndVerify({
      page,
      section: "Event",
      prefix,
      extraSteps: async () => {
        //Select the region
        await page
          .getByRole("combobox")
          .filter({ hasText: "Select a region" })
          .click();
        await page.getByPlaceholder("Select a region").fill("SUPER");
        await page
          .getByRole("option", { name: `${prefix} REGION 2` })
          .first()
          .click();

        // Select the AO
        await page
          .getByRole("combobox")
          .filter({ hasText: "Select an AO" })
          .click();
        await page
          .getByRole("option", { name: `${prefix} AO 2` })
          .first()
          .click();

        // See if location already is selected
        try {
          await expect(
            page
              .getByRole("combobox")
              .filter({ hasText: `${prefix} LOCATION 2` }),
          ).toBeVisible();
        } catch (error) {
          // Select a location
          await page
            .getByRole("combobox")
            .filter({ hasText: "Select a location" })
            .click();
          await page.getByPlaceholder("Select a location").fill(prefix);
          await page
            .getByRole("option", { name: `${prefix} LOCATION 2` })
            .first()
            .click();
        }

        // Day of the week
        await page.getByRole("combobox", { name: "Day of Week" }).click();
        await page.getByRole("option", { name: "Wednesday" }).click();

        // Select Event Type
        await page
          .getByRole("combobox")
          .filter({ hasText: "Select event types" })
          .click();
        await page.getByPlaceholder("Select event types").fill(prefix);
        await page
          .getByRole("option", { name: `${prefix} EVENT TYPE 2` })
          .first()
          .click();

        await page
          .getByRole("combobox")
          .filter({ hasText: `${prefix} EVENT TYPE 2` })
          .click();

        // Set date and time
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateString = tomorrow.toISOString().split("T")[0] ?? "";

        await page.getByLabel("Start Date").fill(dateString);
        await fillTimeInput(page, "startTime", "0600A");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await fillTimeInput(page, "endTime", "0700A");
      },
    });
  });

  test("edit the new Event", async ({ page }) => {
    await goToSection(page, "Events");
    await editItemAndVerify({
      page,
      name: "EVENT",
      order: 2,
      prefix,
    });
  });

  // Delete all test items in reverse order
  test("delete the Event", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Events",
      name: `${prefix} EVENT 2`,
    });
  });

  test("delete the Event Type", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Event Types",
      name: `${prefix} EVENT TYPE 2`,
    });
  });

  test("delete the new Location", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Locations",
      name: `${prefix} LOCATION 2`,
    });
  });

  test("delete the new AO", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "AOs",
      name: `${prefix} AO 2`,
    });
  });

  test("delete the new Region", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Regions",
      name: `${prefix} REGION 2`,
    });
  });

  test("delete the new Area", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Areas",
      name: `${prefix} AREA 2`,
    });
  });

  test("delete the new Sector", async ({ page }) => {
    await deleteItemAndVerify({
      page,
      section: "Sectors",
      name: `${prefix} SECTOR 2`,
    });
  });

  test("clean up test data", async ({ page }) => {
    await cleanupTestData({ page, prefix });
  });
});
