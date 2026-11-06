// The stable "owner" identity for F3-Nation-managed OAuth clients — set as a
// client's referenceId rather than a per-user userId, so any current or
// future nation admin can read, list, and rotate the secret for a client one
// of them created, not just whoever happened to create it. Used by
// oauthProvider's clientReference option in better-auth.ts and by the
// oauth_clients migration script, which has to stamp it on the rows it copies.
export const F3_NATION_CLIENT_REFERENCE_ID = "f3-nation";

// The scopes auth3's oauthProvider advertises and will issue. The list lives
// in @acme/shared so packages/api's admin PATCH checks the same one;
// re-exported here for better-auth.ts and the apps/auth scripts.
export { SUPPORTED_OAUTH_SCOPES } from "@acme/shared/common/oauth-scopes";
