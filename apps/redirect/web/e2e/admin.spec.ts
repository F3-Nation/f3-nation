import { expect, test } from "@playwright/test";

test("sign up, register a domain, and see the DNS records", async ({
  page,
}) => {
  const ts = Date.now();
  const email = `e2e-${ts}@example.com`;
  const host = `e2e${ts}.com`; // apex → expect an A record

  await page.goto("/");

  // Switch to sign-up and create an account.
  await page.getByText("new here? create an account").click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Lands on the dashboard.
  await expect(
    page.getByRole("heading", { name: "Your domains" }),
  ).toBeVisible();

  // Register a domain.
  await page.locator("#hostname").fill(host);
  await page.locator("#destination").fill("https://example.com/e2e");
  await page.getByRole("button", { name: "Register domain" }).click();

  // The domain card appears.
  await expect(page.getByText(host).first()).toBeVisible();

  // Edit the destination in place (no delete+recreate).
  await page.getByRole("button", { name: "Edit destination" }).click();
  const dest = page.locator('input[id^="dest-"]');
  await dest.fill("https://example.com/edited");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("https://example.com/edited")).toBeVisible();

  // Open the DNS records bottom-sheet: required apex A record to the static IP.
  await page.getByRole("button", { name: "View DNS records" }).click();
  await expect(page.getByText("34.172.36.60")).toBeVisible();
  await expect(page.getByText("required").first()).toBeVisible();
});
