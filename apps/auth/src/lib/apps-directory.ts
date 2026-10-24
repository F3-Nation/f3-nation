import { logWarn } from "~/lib/logging";

/**
 * Where the signed-in home page points people to explore the other F3 apps.
 *
 * The directory at apps.f3nation.com has no staging copy, and every app it
 * lists signs in through production auth. Linking to it from a staging auth
 * server sends people to production, where their staging session doesn't
 * exist and they're asked to sign in again. So each deployment says whether
 * to show the link (APPS_DIRECTORY_ENABLED, on unless "false") and where it
 * goes (APPS_DIRECTORY_URL, an http(s) URL; unset keeps the production
 * default). A bad URL hides the link and logs a warning, so a typo can't
 * take down sign-in.
 */
const DEFAULT_APPS_DIRECTORY_URL = "https://apps.f3nation.com";

export function parseAppsDirectoryUrl(raw: string | undefined): URL {
  const value = raw?.trim();
  if (!value) return new URL(DEFAULT_APPS_DIRECTORY_URL);
  const url = URL.parse(value);
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error(
      `APPS_DIRECTORY_URL must be an http(s) URL, got "${value}"`,
    );
  }
  return url;
}

export function appsDirectoryUrl(
  enabled: boolean,
  raw: string | undefined,
): URL | null {
  if (!enabled) return null;
  try {
    return parseAppsDirectoryUrl(raw);
  } catch (err) {
    // parseAppsDirectoryUrl only throws Error.
    logWarn("auth.apps_directory.invalid_url", {
      reason: (err as Error).message,
    });
    return null;
  }
}
