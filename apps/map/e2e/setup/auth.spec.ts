import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test as setup } from "@playwright/test";

// Convert the URL into a file path
const __filename = fileURLToPath(import.meta.url);
// Get the directory name
const __dirname = path.dirname(__filename);

// Create the auth directory if it doesn't exist
const authDir = path.join(__dirname, ".auth");
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

const authFile = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  // Perform authentication steps
  await page.goto("/?lat=36.211104&lng=-81.660849&zoom=3");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign in (Dev Mode)" }).click();

  // Wait to ensure we're authenticated
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  // Save authentication state to file
  await page.context().storageState({ path: authFile });

  console.log("Authentication completed and state saved to:", authFile);
});
