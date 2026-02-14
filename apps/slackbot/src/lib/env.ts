/**
 * Environment configuration for the slackbot.
 *
 * Provides typed access to environment variables.
 */

export const env = {
  /**
   * Bucket name for logo uploads (region logos, AO logos).
   * Falls back to the backblast bucket if not specified.
   */
  LOGO_BUCKET_NAME:
    process.env.GOOGLE_LOGO_BUCKET_BUCKET_NAME ??
    process.env.GCS_BACKBLAST_BUCKET_NAME ??
    "backblast-images",

  /**
   * Bucket name for backblast image uploads.
   */
  BACKBLAST_BUCKET_NAME:
    process.env.GCS_BACKBLAST_BUCKET_NAME ?? "backblast-images",
};
