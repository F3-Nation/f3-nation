/**
 * The API keys staging's own services authenticate with (F3-65).
 *
 * This list is the source of truth for what `api_keys` holds on staging. It
 * carries no key values: those live only where each service reads them
 * (staging's Cloud Run env / Secret Manager) and reach the provisioner through
 * the env var named here. `staging-api-keys --provision` writes exactly these
 * rows after every refresh, and `obfuscate-db:verify-target` fails if staging
 * holds any other live key.
 *
 * Roles are least privilege and mirror the local seed's LOCAL_API_KEYS
 * (packages/db/src/local-seed-lib/data.ts), which proves each app works at
 * that level. `role: null` is read-only: the system's read-only tier is the
 * absence of a role. A role attaches to the nation org, resolved by org type
 * at provision time, never by a carried-over id.
 *
 * Adding a service key: add an entry, put its value in the service's staging
 * env, and re-run `staging-api-keys --provision`.
 */
export interface StagingServiceKey {
  /** api_keys.name — the key's stable identity across refreshes. */
  name: string;
  description: string;
  /** Env var the provisioner reads the value from. */
  valueEnv: string;
  /** Which staging service sends the key, and in which of its env vars. */
  consumer: string;
  role: "editor" | "admin" | null;
}

export const STAGING_SERVICE_KEYS: readonly StagingServiceKey[] = [
  {
    name: "staging: map",
    description: "apps/map server-side reads (static generation)",
    valueEnv: "STAGING_MAP_API_KEY",
    consumer: "map F3_MAP_API_KEY",
    role: null,
  },
  {
    name: "staging: auth",
    description: "apps/auth registering new users through the API",
    valueEnv: "STAGING_AUTH_API_KEY",
    consumer: "auth API_KEY",
    role: "editor",
  },
  {
    name: "staging: slackbot",
    description: "apps/slackbot API client",
    valueEnv: "STAGING_SLACKBOT_API_KEY",
    consumer: "slackbot F3_API_KEY",
    role: "admin",
  },
];

/**
 * Generated keys are `f3_` + 48 hex chars (api-key router's buildApiKey).
 * Anything shorter is refused, so a hand-typed value like "Tackle Testing"
 * can't become a staging service key.
 */
export const MIN_SERVICE_KEY_LENGTH = 32;
