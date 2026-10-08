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
 * Pruned 2026-10-08 to the keys staging's apps use. last_used_at can't
 * tell (the API never writes it), but staging's API logs since the
 * 2026-10-07 refresh show ~1k requests, from node, python-requests and
 * okhttp clients, and not one api_key_not_found: these seven cover them.
 * Dropped: "F3 API Staging" and "F3 Api Staging" (both expired June 2026,
 * one-off tag-deploy tests) and "App Pioneer Poster" (an ad-hoc key for
 * trying new Slack API endpoints).
 */
export const STAGING_API_KEYS_TO_KEEP = [
  // Both owned by admin@F3 Nation. Successful key auth isn't logged, so which
  // one the staging slackbot uses can't be told: keep both.
  "Slackbot (STAGING)",
  "Slackbot staging key",
  // The map's F3_MAP_API_KEY.
  "F3 Map Service Account",
  // The website.
  "org.f3nation.com",
  // The F3 Me app.
  "F3 Me",
  // The auth app.
  "F3 Auth Service (STAGING)",
  // The mobile app.
  "Digital Wienke",
];

/**
 * Tables staging keeps as they are: never truncated, never loaded. Staging
 * registers its own OAuth clients (f3-admin-staging, f3-me-staging, …);
 * loading the copy's (revoked) rows instead broke admin login on 2026-09-24.
 *
 * Both generations of client registration: the legacy oauth_clients /
 * oauth_client, and Better Auth's, which is the active auth path. Better
 * Auth's is a unit: a client_resource row FKs to both a client (client_id)
 * and a resource (identifier), so the three are kept together. The token,
 * consent and assertion tables that point at clients are loaded from the
 * copy, where obfuscate-db empties them.
 *
 * Adding a table here: if it has an FK into a loaded table, the refresh
 * re-points it after the load only when that FK is a single nullable
 * column with ON DELETE SET NULL (better_auth_oauth_client.user_id is), and
 * refuses before touching staging otherwise.
 */
export const PRESERVED_TABLES = [
  "auth.oauth_clients",
  "auth.oauth_client",
  "auth.better_auth_oauth_client",
  "auth.better_auth_oauth_resource",
  "auth.better_auth_oauth_client_resource",
];

/**
 * Restarted after the load so it drops its cached Slack member links
 * (best effort: the job's service account may not have access).
 */
export const STAGING_SLACKBOT = {
  project: "f3-slackbot-staging",
  region: "us-central1",
  service: "f3-slackbot",
};
