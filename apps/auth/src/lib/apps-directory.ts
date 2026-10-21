/**
 * Where the signed-in home page points people to explore the other F3 apps.
 *
 * The directory at apps.f3nation.com has no staging copy, and every app it
 * lists signs in through production auth. Linking to it from a staging auth
 * server sends people to production, where their staging session doesn't
 * exist and they're asked to sign in again. So each deployment says where
 * its directory is: unset keeps the production default, "off" hides the
 * link (staging, until there's a staging directory), anything else must be
 * an http(s) URL. A bad value
 * fails env validation at startup; if one ever slips past, the home page hides
 * the link rather than erroring.
 */
const DEFAULT_APPS_DIRECTORY_URL = "https://apps.f3nation.com";

export function parseAppsDirectoryUrl(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return new URL(DEFAULT_APPS_DIRECTORY_URL);
  if (value.toLowerCase() === "off") return null;
  const url = URL.parse(value);
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error(
      `APPS_DIRECTORY_URL must be an http(s) URL or "off", got "${value}"`,
    );
  }
  return url;
}

export function appsDirectoryUrl(raw: string | undefined): URL | null {
  try {
    return parseAppsDirectoryUrl(raw);
  } catch {
    return null;
  }
}
