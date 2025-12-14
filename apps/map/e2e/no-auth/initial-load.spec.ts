import { expect, test } from "@playwright/test";

import { TestId } from "@acme/shared/common/enums";

import { setStore, setupTestEnvironment, waitForMap } from "../helpers";

test.describe("Initial Load", () => {
  test.beforeEach(async ({ page, context }) => {
    await setupTestEnvironment(page, context);
  });

  test("Should load Yarak with eventId and locationId", async ({ page }) => {
    await page.goto("/?eventId=49303&locationId=49303");
    await waitForMap(page);
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible();
    const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
    await expect(nearbyLocations.getByRole("button").nth(0)).toContainText(
      "Yarak",
    );
    await expect(nearbyLocations.getByRole("button").nth(1)).toContainText(
      "Musket, Wake N Bake",
    );
  });

  test("Should load at the Caboose with lat and lng", async ({ page }) => {
    await page.goto("/?lat=36.401521&lng=-81.500949&zoom=15");
    await waitForMap(page);
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).not.toBeVisible();
    const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
    await expect(nearbyLocations).toBeVisible();
    await expect(
      nearbyLocations.getByText("The Caboose", { exact: true }),
    ).toBeVisible();
  });

  test("Should load Yarak with just locationId", async ({ page }) => {
    await page.goto("/?locationId=49303");
    await waitForMap(page);
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible();
    const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
    await expect(nearbyLocations).toBeVisible();
    await expect(nearbyLocations.getByRole("button").nth(0)).toContainText(
      "Yarak",
    );
    await expect(nearbyLocations.getByRole("button").nth(1)).toContainText(
      "Musket, Wake N Bake",
    );
  });

  test("Should load the Caboose with local storage and no params", async ({
    page,
  }) => {
    await setStore(page, "map-store", {
      state: {
        center: { lat: 36.401643, lng: -81.495066 },
        zoom: 13,
        version: 2,
      },
    });
    await page.goto("/");
    await waitForMap(page);

    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).not.toBeVisible();
    const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
    await expect(nearbyLocations).toBeVisible();
    await expect(nearbyLocations.getByRole("button").nth(0)).toContainText(
      "The Caboose",
    );
  });

  test("Should update to user location", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    const userLocation = {
      latitude: 37.774929,
      longitude: -122.419418,
      accuracy: 100,
    };
    await context.setGeolocation(userLocation);

    await page.goto("/");
    await waitForMap(page);

    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).not.toBeVisible();
    const nearbyLocations = page.getByTestId(TestId.NEARBY_LOCATIONS);
    await expect(nearbyLocations).toBeVisible();
    await expect(nearbyLocations.getByRole("button").nth(0)).toContainText(
      "Full House",
    );
    const geolocationMarker = page.getByTestId(TestId.GEOLOCATION_MARKER);
    await expect(geolocationMarker).toBeVisible();

    // Need to wait for at least 2 seconds for the gps to update
    await page.waitForTimeout(3000);
    const url = new URL(page.url());
    expect(url.searchParams.get("zoom")).toBe("15");
  });
});
