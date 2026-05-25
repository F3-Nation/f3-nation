/**
 * Canonical allowlist for user avatar URLs.
 *
 * The avatar-upload route builds the stored URL server-side, so the only
 * legitimate value for `users.avatar_url` is an object under the F3
 * public-image GCS bucket (prod or staging). Centralizing the pattern here
 * lets the write-path validation (packages/api me router) and the one-time
 * backfill migration (packages/db) share a single source of truth, so the
 * two can never drift.
 *
 * Restricting the host prevents an authenticated user from PATCHing
 * `avatarUrl` to an arbitrary host and using the field for tracking pixels
 * or SSRF when other consumers pre-fetch the URL server-side.
 */
export const ALLOWED_AVATAR_HOST_PATTERN =
  /^https:\/\/storage\.googleapis\.com\/f3-public-images(-staging)?\//;

/** True when `url` points at the canonical F3 public-image GCS bucket. */
export const isAllowedAvatarUrl = (url: string): boolean =>
  ALLOWED_AVATAR_HOST_PATTERN.test(url);
