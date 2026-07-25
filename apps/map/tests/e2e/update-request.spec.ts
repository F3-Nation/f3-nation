import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { TestId } from "@acme/shared/common/enums";

/**
 * Map edit mode & update requests — BLOCKING tier.
 *
 * Browser tests for the update-request flow specified in
 * specs/map-update-request-flow.md. Each test maps 1:1 to an acceptance
 * criterion:
 *
 *   - "AC-1 anonymous edit toggle opens the sign-in modal"
 *       → AC-1 (anonymous visitor clicks edit toggle → sign-in modal, map
 *         stays in view mode).
 *   - "AC-2 signed-in user can toggle edit mode on and off"
 *       → AC-2.
 *   - "AC-3 clicking an empty spot places an update marker with the three
 *      placement request types"
 *       → AC-3 (three placement buttons + clear-marker control).
 *   - "AC-4 location-scoped AO and event menus reach prefilled request modals"
 *       → AC-4 (subset: menu contents + "Edit AO details" / "Edit workout
 *         details" modals prefilled with current values).
 *   - "AC-6 request modal prefills Your Email from the session and disables it"
 *       → AC-6.
 *   - "AC-9 editor submit auto-applies and the change is live on the map"
 *       → AC-9 (modal states immediate application, toast "Update request
 *         automatically applied", modal closes, new AO renders on the map and
 *         is searchable).
 *
 * The pending / RBAC submission outcomes (AC-8, AC-15, unauthenticated 401)
 * are covered API-side in tests/e2e/rbac.spec.ts with region-scoped seeded
 * API keys, because the local dev-mode credentials provider always signs the
 * browser in as a NATION ADMIN (packages/auth/src/config.ts authorize()), so
 * the browser can only exercise the auto-apply path.
 *
 * DATA ASSUMPTIONS (deterministic local seed — packages/db/src/local-seed-lib):
 *   - Org tree: F3 Nation → F3 Southeast → { F3 Western NC → region "Boone",
 *     F3 Metrolina → region "F3 Charlotte" }.
 *   - Boone AOs: "The Dark Tower", "The Viaduct".
 *     Charlotte AOs: "The Colosseum", "South End Station", "The Foundry".
 *   - Every AO has exactly one weekly "<AO name> Bootcamp" event on Monday
 *     05:30–06:15 AM.
 *   - The dev-mode credentials provider is enabled and signs in ANY email as
 *     a nation-admin mock session.
 *   - Data these tests create uses unique name suffixes and Monday 05:30 AM
 *     events, so reruns never collide and browse-suite determinism holds.
 *
 * Both suites ride on two fixes that landed with this spec file: the
 * edit-mode toggle is labelled aria-label="Edit map" (it previously carried a
 * copy-pasted "My Location" label) and SignInModal renders the message it is
 * opened with (AC-1's "You must log in to edit the map").
 */

const MAP_SELECTOR = '[aria-label="Map"]';
// First navigation per worker can sit through a dev-server compile.
const FIRST_LOAD_TIMEOUT = 45_000;

const E2E_API_URL = process.env.E2E_API_URL;

/** Unique per-run suffix so created entities never collide across reruns. */
const uniqueSuffix = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Sign in via the dev-mode credentials provider (nation-admin mock session):
 * fetch the CSRF token, then post the callback. context.request shares its
 * cookie jar with the browser context, so pages are signed in afterwards.
 */
async function devSignIn(context: BrowserContext, email: string) {
  const csrfRes = await context.request.get("/api/auth/csrf");
  expect(csrfRes.ok()).toBe(true);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const cbRes = await context.request.post("/api/auth/callback/dev-mode", {
    form: { csrfToken, email, json: "true" },
  });
  expect(cbRes.status(), "dev-mode callback should succeed").toBeLessThan(400);

  const session = (await (
    await context.request.get("/api/auth/session")
  ).json()) as { email?: string } | null;
  expect(session?.email, "dev-mode session should be established").toBe(email);
}

function editToggle(page: Page): Locator {
  return page.locator('div[aria-label="Edit map"]').first();
}

async function gotoMap(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(MAP_SELECTOR).first()).toBeVisible({
    timeout: FIRST_LOAD_TIMEOUT,
  });
}

/** Turn edit mode on and wait for the toggle to show its active style. */
async function enterEditMode(page: Page) {
  const toggle = editToggle(page);
  await toggle.click();
  await expect(toggle).toHaveClass(/bg-blue-500/, { timeout: 15_000 });
}

/**
 * Click an empty map spot and wait for the update marker. The center is
 * randomized per run so locations created by previous runs (AC-9) never sit
 * under the click point.
 */
async function placeUpdateMarker(page: Page) {
  const map = page.locator(MAP_SELECTOR).first();
  const box = await map.boundingBox();
  if (!box) throw new Error("Map bounding box not available");
  await page.mouse.click(
    box.x + box.width * (0.55 + Math.random() * 0.3),
    box.y + box.height * (0.25 + Math.random() * 0.35),
  );
  await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible({
    timeout: 15_000,
  });
}

/** Random center near (but not on top of) the seeded Boone AOs. */
function randomBooneUrl() {
  const lat = (36.05 + Math.random() * 0.3).toFixed(5);
  const lng = (-81.9 + Math.random() * 0.35).toFixed(5);
  return `/?lat=${lat}&lng=${lng}&zoom=14`;
}

test.describe("map update-request flow", () => {
  test("AC-1 anonymous edit toggle opens the sign-in modal", async ({
    page,
  }) => {
    await gotoMap(page, "/?lat=36.2168&lng=-81.6746&zoom=14");

    const toggle = editToggle(page);
    await toggle.click();

    const dialog = page.getByRole("dialog").filter({ visible: true });
    await expect(dialog.getByText("Sign in to F3 Nation")).toBeVisible();
    await expect(
      dialog.getByText("You must log in to edit the map"),
    ).toBeVisible();

    // The map must remain in view mode (toggle never gets its active style).
    await expect(toggle).not.toHaveClass(/bg-blue-500/);
  });

  test("AC-2 signed-in user can toggle edit mode on and off", async ({
    page,
    context,
  }) => {
    await devSignIn(context, "dev-editor@f3local.dev");
    await gotoMap(page, "/?lat=36.2168&lng=-81.6746&zoom=14");

    const toggle = editToggle(page);
    await toggle.click();
    await expect(toggle).toHaveClass(/bg-blue-500/);

    await toggle.click();
    await expect(toggle).not.toHaveClass(/bg-blue-500/);
    // No sign-in modal for an authenticated user.
    await expect(
      page.getByRole("dialog").filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("AC-3 clicking an empty spot places an update marker with the three placement request types", async ({
    page,
    context,
  }) => {
    await devSignIn(context, "dev-editor@f3local.dev");
    await gotoMap(page, randomBooneUrl());
    await enterEditMode(page);
    await placeUpdateMarker(page);

    for (const name of [
      "New location, AO, & event",
      "Move existing AO here",
      "Move existing event here",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }

    // ...and a control to clear the marker, which removes it again.
    const clear = page.getByRole("button", {
      name: "Clear update location marker",
    });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toHaveCount(0);
  });

  test("AC-4 location-scoped AO and event menus reach prefilled request modals", async ({
    page,
    context,
  }) => {
    if (!E2E_API_URL) {
      throw new Error(
        "E2E_API_URL is required to resolve seeded ids, e.g. " +
          "E2E_API_URL=http://localhost:3001",
      );
    }
    await devSignIn(context, "dev-editor@f3local.dev");

    // Resolve the seeded Dark Tower Bootcamp at runtime (never hardcode ids).
    const eventsRes = await context.request.get(`${E2E_API_URL}/v1/event`, {
      params: { searchTerm: "The Dark Tower Bootcamp" },
      headers: { Authorization: "Bearer local-map-key", client: "e2e" },
    });
    expect(eventsRes.ok()).toBe(true);
    const { events } = (await eventsRes.json()) as {
      events: { id: number; name: string; locationId: number }[];
    };
    const bootcamp = events.find((e) => e.name === "The Dark Tower Bootcamp");
    expect(bootcamp, "seeded Dark Tower Bootcamp should exist").toBeTruthy();
    if (!bootcamp) return;

    // Deep-link selects the location and opens the desktop panel.
    await gotoMap(
      page,
      `/?locationId=${bootcamp.locationId}&eventId=${bootcamp.id}`,
    );
    const panel = page.getByTestId(TestId.PANEL);
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await enterEditMode(page);

    // Create-event entry point for the selected location.
    await expect(
      panel.getByRole("button", { name: "Add Workout to AO" }),
    ).toBeVisible();

    // AO menu → the four AO-scoped request types.
    await panel.getByRole("button", { name: /^Edit AO:/ }).click();
    for (const item of [
      "Edit AO details",
      "Move AO to different location",
      "Move AO to different region",
      "Delete this AO",
    ]) {
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    }
    await page.getByRole("menuitem", { name: "Edit AO details" }).click();
    const aoDialog = page.getByRole("dialog").filter({ visible: true }).first();
    await expect(
      aoDialog.getByRole("heading", { name: "Edit AO Details" }),
    ).toBeVisible({ timeout: 30_000 });
    // Prefilled with the AO's current values.
    await expect(aoDialog.locator('input[name="aoName"]')).toHaveValue(
      "The Dark Tower",
    );
    await aoDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("dialog").filter({ visible: true }),
    ).toHaveCount(0);

    // Event menu → the four event-scoped request types.
    await panel.getByRole("button", { name: /^Edit Workout:/ }).click();
    for (const item of [
      "Edit workout details",
      "Move to different AO",
      "Move to a new AO",
      "Delete this workout",
    ]) {
      await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
    }
    await page.getByRole("menuitem", { name: "Edit workout details" }).click();
    const eventDialog = page
      .getByRole("dialog")
      .filter({ visible: true })
      .first();
    await expect(
      eventDialog.getByRole("heading", { name: "Edit workout details" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(eventDialog.locator('input[name="eventName"]')).toHaveValue(
      "The Dark Tower Bootcamp",
    );
    await eventDialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("AC-6 request modal prefills Your Email from the session and disables it", async ({
    page,
    context,
  }) => {
    const email = "dev-editor@f3local.dev";
    await devSignIn(context, email);
    await gotoMap(page, randomBooneUrl());
    await enterEditMode(page);
    await placeUpdateMarker(page);

    await page
      .getByRole("button", { name: "New location, AO, & event", exact: true })
      .click();
    const dialog = page.getByRole("dialog").filter({ visible: true }).first();
    await expect(dialog.getByText("Your Email")).toBeVisible({
      timeout: 30_000,
    });

    const emailInput = dialog.locator('input[name="submittedBy"]');
    await expect(emailInput).toHaveValue(email);
    await expect(emailInput).toBeDisabled();
  });

  test("AC-9 editor submit auto-applies and the change is live on the map", async ({
    page,
    context,
  }) => {
    await devSignIn(context, "dev-editor@f3local.dev");
    const suffix = uniqueSuffix();
    const aoName = `E2E AO ${suffix}`;
    const eventName = `E2E Event ${suffix}`;

    await gotoMap(page, randomBooneUrl());
    await enterEditMode(page);
    await placeUpdateMarker(page);
    await page
      .getByRole("button", { name: "New location, AO, & event", exact: true })
      .click();

    const dialog = page.getByRole("dialog").filter({ visible: true }).first();
    await expect(dialog.getByText("Your Email")).toBeVisible({
      timeout: 30_000,
    });
    // The modal states the change will be reflected immediately (the dev-mode
    // session is a nation admin, i.e. an editor of every affected region).
    await expect(
      dialog.getByText("these changes will be reflected immediately"),
    ).toBeVisible({ timeout: 15_000 });

    await dialog
      .locator('input[name="locationAddress"]')
      .fill("123 E2E Street");
    await dialog.locator('input[name="locationCity"]').fill("Boone");
    await dialog.locator('input[name="locationState"]').fill("NC");
    await dialog.locator('input[name="locationZip"]').fill("28607");
    await dialog.locator('input[name="aoName"]').fill(aoName);
    // Keep created events Monday 05:30 AM (form default) for browse-suite
    // determinism; only the name is unique.
    await dialog.locator('input[name="eventName"]').fill(eventName);
    await dialog.getByRole("button", { name: "Select event types" }).click();
    await page.getByRole("option", { name: "Bootcamp" }).click();
    // Dismiss the multiselect popover without Escape (Escape closes the modal).
    await dialog.getByText("Event Description").click();

    await dialog
      .getByRole("button", { name: "Create New Location, AO & Workout" })
      .click();

    await expect(
      page.getByText("Update request automatically applied"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("dialog").filter({ visible: true }),
    ).toHaveCount(0);

    // The change is live: the new AO renders on the map at the marker spot...
    await expect(page.getByText(aoName).first()).toBeVisible({
      timeout: 30_000,
    });

    // ...and is findable through the map search box.
    const search = page
      .getByTestId(TestId.MAP_SEARCHBOX_INPUT)
      .locator("visible=true")
      .first();
    await search.click();
    await search.fill(aoName);
    await expect(
      page
        .getByTestId(TestId.MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP)
        .getByText(aoName),
    ).toBeVisible({ timeout: 15_000 });
  });
});
