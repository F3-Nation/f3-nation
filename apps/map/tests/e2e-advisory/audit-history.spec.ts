import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { TestId } from "@acme/shared/common/enums";

// This database connection belongs to the test runner, never the browser.
// Remote previews without direct DB access report this local verification gap.
const databaseUrl = process.env.E2E_AUDIT_DATABASE_URL;

test("audit AC-3/32: map submission creates masked database history", async ({
  page,
  context,
}) => {
  test.skip(
    !databaseUrl,
    "E2E_AUDIT_DATABASE_URL must identify the disposable map/API database",
  );
  if (!databaseUrl) return;
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connection: { default_transaction_read_only: true },
  });
  try {
    const csrf = await context.request.get("/api/auth/csrf");
    expect(csrf.ok()).toBe(true);
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const login = await context.request.post("/api/auth/callback/dev-mode", {
      form: { csrfToken, email: "dev-editor@f3local.dev", json: "true" },
      maxRedirects: 0,
    });
    expect(login.status()).toBeLessThan(400);
    const name = `Audit E2E ${randomUUID()}`;
    await page.goto("/?lat=36.13&lng=-81.81&zoom=15", {
      waitUntil: "domcontentloaded",
    });
    const map = page.locator('[aria-label="Map"]').first();
    await expect(map).toBeVisible({ timeout: 45000 });
    const toggle = page.locator('div[aria-label="Edit map"]').first();
    await toggle.click();
    await expect(toggle).toHaveClass(/bg-blue-500/);
    const bounds = await map.boundingBox();
    if (!bounds) throw new Error("Map bounds unavailable");
    await page.mouse.click(
      bounds.x + bounds.width * 0.7,
      bounds.y + bounds.height * 0.4,
    );
    await expect(page.getByTestId(TestId.UPDATE_PANE_MARKER)).toBeVisible();
    await page
      .getByRole("button", { name: "New location, AO, & event", exact: true })
      .click();
    const dialog = page.getByRole("dialog").filter({ visible: true }).first();
    await expect(dialog.locator('input[name="submittedBy"]')).toHaveValue(
      "dev-editor@f3local.dev",
    );
    await dialog
      .locator('input[name="locationAddress"]')
      .fill("123 Audit Test Street");
    await dialog.locator('input[name="locationCity"]').fill("Boone");
    await dialog.locator('input[name="locationState"]').fill("NC");
    await dialog.locator('input[name="locationZip"]').fill("28607");
    await dialog.locator('input[name="aoName"]').fill(name);
    await dialog.locator('input[name="eventName"]').fill(`${name} Bootcamp`);
    await dialog.getByRole("button", { name: "Select event types" }).click();
    await page.getByRole("option", { name: "Bootcamp", exact: true }).click();
    await dialog.getByText("Event Description").click();
    await dialog
      .getByRole("button", { name: "Create New Location, AO & Workout" })
      .click();
    await expect(
      page.getByText("Update request automatically applied"),
    ).toBeVisible({ timeout: 30000 });
    const rows = await client<
      { id: string; op: string; token_masked: boolean; old_empty: boolean }[]
    >`
      SELECT r.id, h.op, h.new_row->>'token' = '[redacted]' AS token_masked,
        h.old_row IS NULL AS old_empty
      FROM public.update_requests r JOIN public_history.update_requests h ON h.row_id=r.id::text
      WHERE r.ao_name=${name} AND h.op='I'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      op: "I",
      token_masked: true,
      old_empty: true,
    });
  } finally {
    await client.end();
  }
});
