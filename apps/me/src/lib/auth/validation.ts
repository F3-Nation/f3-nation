/**
 * Validate that a return-to path is safe (relative, no open-redirect).
 * Rejects absolute URLs, protocol-relative URLs, and non-path values.
 */
export function isValidReturnTo(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // Reject any backslash, CR, LF, or tab anywhere in the path -- some URL
  // parsers normalize these into authority delimiters.
  if (/[\\\r\n\t]/.test(path)) return false;
  return true;
}

/** Sanitize a return-to value, falling back to /profile if invalid. */
export function safeReturnTo(path: string | null | undefined): string {
  if (!path) return "/profile";
  return isValidReturnTo(path) ? path : "/profile";
}
