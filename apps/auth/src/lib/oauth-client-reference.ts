// The stable "owner" identity for F3-Nation-managed OAuth clients — set as a
// client's referenceId rather than a per-user userId, so any current or
// future nation admin can read, list, and rotate the secret for a client one
// of them created, not just whoever happened to create it. Used by
// oauthProvider's clientReference option in better-auth.ts and by the
// oauth_clients migration script, which has to stamp it on the rows it copies.
export const F3_NATION_CLIENT_REFERENCE_ID = "f3-nation";

// The scopes auth3's oauthProvider advertises and will issue. Shared by
// better-auth.ts (the plugin's `scopes` option) and the oauth_clients
// migration script, which refuses legacy rows asking for anything else.
// packages/api's oauth-client router keeps its own copy for the admin PATCH
// (it can't import from apps/auth); keep the two in sync.
export const SUPPORTED_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;
