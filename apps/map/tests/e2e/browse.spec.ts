import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Blocking-tier E2E suite for anonymous map browse & search.
 *
 * Implements the critical-path test cases from
 * specs/map-browse-and-search.md §8 (the blocking tier):
 *
 *   1. Anonymous map load, no auth wall            (AC-1, AC-2)
 *   2. Search a known workout → select → navigate  (AC-5)
 *   3. Detail panel with name/directions, close    (AC-8)
 *   4. Time filter reduces results; Reset restores (AC-12/13)
 *
 * DATA ASSUMPTION: the target (E2E_BASE_URL) is a preview environment backed
 * by the deterministic sandbox seed (packages/db/src/local-seed-lib/data.ts):
 * Boone AOs "The Dark Tower" and "The Viaduct"; Charlotte AOs "The Foundry",
 * "The Colosseum", and "South End Station". Every seeded AO has exactly one
 * weekly Bootcamp named "<AO name> Bootcamp" on Monday at 05:30 (AM). That
 * makes the AM/PM quick filters deterministic (PM → empty, AM → everything)
 * regardless of the day the suite runs, so test 4 filters by time of day
 * rather than the "Today" day filter.
 *
 * TODO(F3-59 follow-up): critical path 5 (copied event link reopens centered
 * on the location, AC-10) is intentionally not covered yet — asserting "map
 * centered on X" without auto-opening the panel (owner decision §10.2) needs
 * a stable signal (e.g. reading clipboard + map-store state) to be
 * deterministic. Add it once a reliable centering assertion exists.
 *
 * specs/map-update-request-flow.md (edit mode / update requests) is covered
 * by rbac.spec.ts in this directory, which exercises the RBAC-critical paths
 * directly against the api preview (E2E_API_URL) using seeded API keys.
 */

/** Type a query and click the matching F3 workout result in the popover. */
async function searchAndSelectWorkout(page: Page, query: string) {
  const input = page.getByTestId("map-searchbox-input");
  await input.click();
  await input.fill(query);

  const popover = page.getByTestId("map-searchbox-popover-content-desktop");
  await expect(popover).toBeVisible();

  // F3 workout rows render as buttons; the seeded event is "<AO> Bootcamp".
  const result = popover.getByRole("button").filter({ hasText: query }).first();
  await expect(result).toBeVisible();
  await result.click();

  const selectedItem = page.getByTestId("selected-item-desktop");
  await expect(selectedItem).toBeVisible();
  return selectedItem;
}

test.describe("map browse & search (anonymous)", () => {
  test("map loads anonymously with a live workout count", async ({ page }) => {
    await page.goto("/");

    // No sign-in prompt or auth redirect — we stay on the map route (AC-1).
    await expect(page.getByTestId("map")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");

    // The search placeholder swaps its "5000+" fallback for the live count
    // once the workoutCount query resolves — this proves the whole
    // map → api → seeded-db chain is up (AC-2).
    await expect(page.getByTestId("map-searchbox-input")).toHaveAttribute(
      "placeholder",
      /^Search \d+ free, peer-led workouts$/,
      { timeout: 30_000 },
    );
  });

  test("searching a workout and selecting it navigates the map", async ({
    page,
  }) => {
    await page.goto("/");

    // Selecting the F3 workout result pans/zooms and marks it selected (AC-5).
    await searchAndSelectWorkout(page, "The Foundry");
  });

  test("selected workout opens a detail panel with directions", async ({
    page,
  }) => {
    await page.goto("/");

    const selectedItem = await searchAndSelectWorkout(page, "The Foundry");

    // Clicking the selected item opens the location detail panel (AC-8).
    await selectedItem.click();
    const panel = page.getByTestId("panel");
    await expect(panel).toBeVisible();

    // Workout name (seeded event is "<AO name> Bootcamp") …
    await expect(panel.getByText("The Foundry Bootcamp").first()).toBeVisible();
    // … and a Google Maps directions link.
    await expect(
      panel.locator('a[href*="google.com/maps"]').first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Close location panel" }).click();
    await expect(panel).not.toBeVisible();
  });

  test("AM/PM quick filters change the nearby list and Reset restores it", async ({
    page,
  }) => {
    await page.goto("/");

    const nearby = page.getByTestId("nearby-locations");
    // Seeded data is fully loaded once a known AO shows in the nearby list.
    await expect(nearby.getByText("The Dark Tower")).toBeVisible({
      timeout: 30_000,
    });

    // The mobile filter bar renders the same buttons CSS-hidden at desktop
    // width, so scope every control lookup to visible elements.
    const amButton = page
      .getByRole("button", { name: "AM", exact: true })
      .filter({ visible: true });
    const pmButton = page
      .getByRole("button", { name: "PM", exact: true })
      .filter({ visible: true });

    // Every seeded event is at 05:30 (AM), so PM deterministically empties
    // the list (AC-12 empty state).
    await pmButton.click();
    // Note: isAnyFilterActive() deliberately excludes am/pm, so this empty
    // state renders WITHOUT the "matching your filters" suffix.
    await expect(nearby.getByText(/No locations found/)).toBeVisible();
    await expect(nearby.getByText("The Dark Tower")).toBeHidden();

    // AM deactivates PM (mutually exclusive, AC-13) and matches everything.
    await amButton.click();
    await expect(amButton).toHaveClass(/bg-red-500/);
    await expect(pmButton).not.toHaveClass(/bg-red-500/);
    await expect(nearby.getByText("The Dark Tower")).toBeVisible();

    // Reset (inside the "All filters" drawer) restores the unfiltered state
    // and closes the drawer (AC-13).
    await page
      .getByRole("button", { name: "All filters" })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("button", { name: "Reset", exact: true })
      .filter({ visible: true })
      .click();
    await expect(amButton).not.toHaveClass(/bg-red-500/);
    await expect(nearby.getByText("The Dark Tower")).toBeVisible();
  });
});
