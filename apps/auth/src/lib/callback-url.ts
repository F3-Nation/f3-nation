/**
 * Returns true if `callbackUrl` is safe to redirect to:
 * - A relative path starting with "/" (but not "//") that resolves to the auth origin
 * - An absolute URL whose origin matches `authUrl`
 * An invalid `authUrl` is rejected.
 *
 * This prevents open-redirect attacks where an attacker supplies an external
 * URL as the callbackUrl and gets it embedded into an emailed magic link or
 * used as the post-sign-in redirect destination.
 */
export function isValidCallbackUrl(
  callbackUrl: string,
  authUrl: string,
): boolean {
  if (!callbackUrl || callbackUrl.startsWith("//")) return false;

  try {
    const auth = new URL(authUrl);
    // Resolve relative paths as the browser does: backslashes and control
    // characters can turn an apparent path into an external destination.
    const cb = callbackUrl.startsWith("/")
      ? new URL(callbackUrl, auth)
      : new URL(callbackUrl);
    return cb.origin === auth.origin;
  } catch {
    return false;
  }
}
