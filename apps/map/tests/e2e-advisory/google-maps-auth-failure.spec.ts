import { expect, test } from "@playwright/test";

/**
 * Advisory-tier E2E for docs/specs/map-browse-and-search.md AC-19: when
 * Google Maps rejects the API key, the map shows a "Google Maps isn't
 * available" message instead of the error page.
 *
 * Google disables its marker class when it rejects a key, so without the
 * fallback the next marker the map mounts throws a TypeError from inside
 * Google's code and the app's error boundary replaces the page. The test
 * forces a real rejection by rewriting the key in the Maps JavaScript API
 * request, which works against any target whatever key it is configured with.
 * It depends on Google's servers, so it lives in the advisory tier.
 *
 * It asserts what the visitor sees rather than a clean console: React logs
 * errors its boundaries catch, and Google's own scripts throw after the map
 * is removed.
 */

const MAPS_BOOTSTRAP = "https://maps.googleapis.com/maps/api/js?**";

test("a rejected Google Maps key shows the fallback instead of the error page", async ({
  page,
}) => {
  await page.route(MAPS_BOOTSTRAP, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("key", "e2e-rejected-key");
    await route.continue({ url: url.toString() });
  });

  await page.goto("/");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google Maps isn't available right now" }),
  ).toBeVisible();
  await expect(page.getByTestId("map")).toHaveCount(0);

  // Markers that mounted just before the rejection throw within a few hundred
  // milliseconds; the fallback must still be the page after they have.
  await page.waitForTimeout(2_000);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google Maps isn't available right now" }),
  ).toBeVisible();
});
