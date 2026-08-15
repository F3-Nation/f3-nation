import { expect, test } from "@playwright/test";

/**
 * Advisory-tier E2E suite for anonymous map browse & search.
 *
 * Covers useful-but-not-critical ACs from specs/map-browse-and-search.md §8
 * that were deliberately left out of the blocking tier (tests/e2e/):
 *
 *   1. Keyboard navigation of search results (AC-7)
 *   2. Geolocation permission denied degrades gracefully (AC-14, denied path)
 *
 * Failures here NEVER block a merge — CI runs this suite with
 * `continue-on-error` and the results feed triage (see docs/E2E_TIERS.md).
 * That buys room for assertions that are real but inherently less
 * deterministic (async Places results shifting indexes, permission
 * emulation), without normalizing flakes: repeated failures should be fixed
 * or the test deleted, not ignored.
 *
 * Same DATA ASSUMPTION as the blocking suite: E2E_BASE_URL points at a
 * preview environment backed by the deterministic sandbox seed (Boone AO
 * "The Dark Tower" et al.; every AO has one weekly 05:30 Bootcamp).
 */

/** Matches the standalone focused-row class, not `hover:bg-foreground/5`. */
const FOCUSED_ROW_CLASS = /(^|\s)bg-foreground\/5(\s|$)/;

test.describe("map browse & search extras (anonymous, advisory)", () => {
  test("search results are keyboard navigable: arrows move focus, Enter selects (AC-7)", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByTestId("map-searchbox-input");
    await input.click();
    await input.fill("The Dark Tower");

    const popover = page.getByTestId("map-searchbox-popover-content-desktop");
    await expect(popover).toBeVisible();

    // The seeded F3 workout row must be in the results before we start
    // arrowing (results stream in async).
    const workoutRow = popover
      .getByRole("button")
      .filter({ hasText: "The Dark Tower" })
      .first();
    await expect(workoutRow).toBeVisible();
    // Row markup: <button><CardHeader(div) …bg-foreground/5-when-focused…
    const workoutRowHeader = workoutRow.locator("div").first();

    const isWorkoutRowFocused = async () =>
      FOCUSED_ROW_CLASS.test(
        (await workoutRowHeader.getAttribute("class")) ?? "",
      );

    // ArrowDown walks focus down the list until the workout row is focused.
    // On desktop, Places (geocoded) rows list before F3 workout rows and
    // their count varies, so walk rather than press a fixed number of times.
    let downPresses = 0;
    while (!(await isWorkoutRowFocused())) {
      expect(
        downPresses++,
        "ArrowDown should reach the seeded workout row",
      ).toBeLessThan(15);
      await input.press("ArrowDown");
    }

    // ArrowUp moves focus back up (or clamps at the first row).
    await input.press("ArrowUp");
    if (downPresses > 0) {
      expect(await isWorkoutRowFocused()).toBe(false);
      await input.press("ArrowDown");
    }
    expect(await isWorkoutRowFocused()).toBe(true);

    // Enter activates the focused result: the workout becomes the selected
    // item and the results popover closes.
    await input.press("Enter");
    await expect(page.getByTestId("selected-item-desktop")).toBeVisible();
    await expect(popover).not.toBeVisible();
  });

  test("denied geolocation leaves the map view usable, control muted, no marker (AC-14)", async ({
    page,
  }) => {
    // Establish a real "denied" geolocation state before any page script runs.
    // grantPermissions([]) does NOT deny — it leaves Chromium in "prompt" — so
    // stub the Permissions API and geolocation directly to force denial, which
    // is what the app's `navigator.permissions.query({ name: "geolocation" })`
    // and getCurrentPosition paths key on.
    await page.addInitScript(() => {
      navigator.permissions.query = () =>
        Promise.resolve({ state: "denied" } as PermissionStatus);
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error?.({
          code: 1, // PERMISSION_DENIED
          message: "User denied Geolocation",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      };
    });

    await page.goto("/");
    await expect(page.getByTestId("map")).toBeVisible();

    // Anchor the current view: a seeded Boone AO is in the nearby list.
    const nearby = page.getByTestId("nearby-locations");
    await expect(nearby.getByText("The Dark Tower")).toBeVisible({
      timeout: 30_000,
    });

    // Press "My Location" with permission denied…
    const control = page
      .locator('[aria-label="My Location"]')
      .filter({ visible: true })
      .first();
    await control.click();

    // The observable AC-14 contract, now that denial is deterministic:
    // …no geolocation marker is rendered…
    await expect(page.getByTestId("geolocation-marker")).toHaveCount(0);
    // …and the map view is unchanged: same route, same nearby anchor.
    await expect(nearby.getByText("The Dark Tower")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });
});
