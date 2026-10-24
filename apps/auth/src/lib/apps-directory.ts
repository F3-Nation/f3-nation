import { logWarn } from "~/lib/logging";

/**
 * Where auth's home page points people to explore the other F3 apps.
 *
 * The directory at apps.f3nation.com lists production apps, so linking to it
 * from staging sends people out of staging (and, for apps that sign in
 * through auth, to a sign-in their staging session doesn't cover). So each
 * deployment says whether
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

export function appsDirectoryEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() !== "false";
}

export function appsDirectoryUrl(
  enabledRaw: string | undefined,
  raw: string | undefined,
): URL | null {
  if (!appsDirectoryEnabled(enabledRaw)) return null;
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
