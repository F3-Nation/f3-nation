/**
 * Where the signed-in home page points people to explore the other F3 apps.
 *
 * The directory at apps.f3nation.com has no staging copy, and every app it
 * lists signs in through production auth. Linking to it from a staging auth
 * server sends people to production, where their staging session doesn't
 * exist and they're asked to sign in again. So each deployment says where
 * its directory is: unset keeps the production default, "off" hides the
 * link (staging, until there's a staging directory), anything else must be
 * a URL.
 */
const DEFAULT_APPS_DIRECTORY_URL = "https://apps.f3nation.com";

export function appsDirectoryUrl(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return new URL(DEFAULT_APPS_DIRECTORY_URL);
  if (value.toLowerCase() === "off") return null;
  return new URL(value);
}
