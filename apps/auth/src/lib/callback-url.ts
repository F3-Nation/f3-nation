/**
 * Returns true if `callbackUrl` is safe to redirect to:
 * - A relative path starting with "/" (but not "//" which is protocol-relative)
 * - An absolute URL whose origin matches `authUrl`
 *
 * This prevents open-redirect attacks where an attacker supplies an external
 * URL as the callbackUrl and gets it embedded into an emailed magic link or
 * used as the post-sign-in redirect destination.
 */
export function isValidCallbackUrl(
  callbackUrl: string,
  authUrl: string,
): boolean {
  if (!callbackUrl) return false;

  // Relative path — safe as long as it isn't protocol-relative ("//evil.com")
  if (callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) return true;

  // Absolute URL — only allow same origin as the auth server
  try {
    const cb = new URL(callbackUrl);
    const auth = new URL(authUrl);
    return cb.origin === auth.origin;
  } catch {
    return false;
  }
}
