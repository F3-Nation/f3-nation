// The stable "owner" identity for F3-Nation-managed OAuth clients — set as a
// client's referenceId rather than a per-user userId, so any current or
// future nation admin can read, list, and rotate the secret for a client one
// of them created, not just whoever happened to create it. Used by
// oauthProvider's clientReference option in better-auth.ts and by the
// oauth_clients migration script, which has to stamp it on the rows it copies.
export const F3_NATION_CLIENT_REFERENCE_ID = "f3-nation";
