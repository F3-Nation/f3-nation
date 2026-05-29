import { expect, test } from "@playwright/test";

// End-to-end passkey flow using a CDP virtual authenticator (no physical
// device needed): sign up with email+password, add a passkey, sign out, then
// sign in with the passkey.
test("add a passkey, then sign in with it", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const ts = Date.now();
  const email = `pk-${ts}@example.com`;

  // Sign up (email + password primary).
  await page.goto("/");
  await page.getByText("new here? create an account").click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("passkey-e2e-123456");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Your domains" }),
  ).toBeVisible();

  // Add a passkey (secondary).
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText(/passkey added/i)).toBeVisible({
    timeout: 15_000,
  });

  // Sign out, then sign in with the passkey.
  await page.getByText("sign out").click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();

  // Back on the dashboard, authenticated via passkey alone.
  await expect(page.getByRole("heading", { name: "Your domains" })).toBeVisible(
    { timeout: 15_000 },
  );
});
