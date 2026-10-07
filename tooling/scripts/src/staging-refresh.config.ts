/**
 * What the one-command staging refresh (staging-refresh.ts) keeps of
 * staging's own state across a load. Edit here, not in the orchestrator.
 */

/**
 * Staging's own API keys to put back after the load, by name (see
 * staging-api-keys.ts). Every other stashed key is dropped, so ad-hoc test
 * keys don't outlive a refresh. A name that isn't on staging is a warning,
 * not a failure; a name that matches more than one stashed key stops the
 * refresh before staging is touched.
 *
 * REVIEWERS: prune this. It was copied from the keys kept by hand on the
 * 2026-10-07 refresh, so some entries may be duplicates or no longer used
 * ("F3 API Staging" vs "F3 Api Staging", "Slackbot (STAGING)" vs "Slackbot
 * staging key"). A key that should die with the refresh must not be here.
 */
export const STAGING_API_KEYS_TO_KEEP = [
  "Slackbot (STAGING)",
  "F3 Map Service Account",
  "org.f3nation.com",
  "F3 Me",
  "F3 Auth Service (STAGING)",
  "Slackbot staging key",
  "F3 API Staging",
  "F3 Api Staging",
  "App Pioneer Poster",
  "Digital Wienke",
];

/**
 * Tables staging keeps as they are: never truncated, never loaded. Staging
 * registers its own OAuth clients (f3-admin-staging, f3-me-staging, …);
 * loading the copy's (revoked) rows instead broke admin login on 2026-09-24.
 */
export const PRESERVED_TABLES = ["auth.oauth_clients", "auth.oauth_client"];

/**
 * Restarted after the load so it drops its cached Slack member links
 * (best effort: the job's service account may not have access).
 */
export const STAGING_SLACKBOT = {
  project: "f3-slackbot-staging",
  region: "us-central1",
  service: "f3-slackbot",
};
