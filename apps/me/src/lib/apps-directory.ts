import { logWarn } from "@/lib/logging";

/**
 * Where the profile page's "Explore F3 Nation" card links, from the same two
 * settings auth uses (apps/auth/src/lib/apps-directory.ts):
 * APPS_DIRECTORY_ENABLED shows the card unless it is "false", and
 * APPS_DIRECTORY_URL is where it goes (unset keeps the production
 * directory). The directory lists production apps, so staging turns the card
 * off or points it at a staging directory. A bad URL hides the card and logs
 * a warning instead of breaking the profile page.
 */
const DEFAULT_APPS_DIRECTORY_URL = "https://apps.f3nation.com";

export function appsDirectoryUrl(
  enabledRaw: string | undefined,
  urlRaw: string | undefined,
): URL | null {
  if (enabledRaw?.trim().toLowerCase() === "false") return null;
  const value = urlRaw?.trim();
  if (!value) return new URL(DEFAULT_APPS_DIRECTORY_URL);
  const url = URL.parse(value);
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
    logWarn("me.apps_directory.invalid_url", {
      reason: `APPS_DIRECTORY_URL must be an http(s) URL, got "${value}"`,
    });
    return null;
  }
  return url;
}
