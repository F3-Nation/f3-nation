/**
 * The scopes auth3's Better Auth `oauthProvider` advertises and will issue,
 * and the only ones an OAuth client may be registered with. openid is
 * required on every client: auth3 only serves OpenID Connect requests.
 *
 * One list for every place that checks client scopes: apps/auth
 * (better-auth.ts, the oauth_clients migration, add-client) and
 * packages/api's oauth-client router (the admin PATCH).
 */
export const SUPPORTED_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

export type SupportedOAuthScope = (typeof SUPPORTED_OAUTH_SCOPES)[number];
