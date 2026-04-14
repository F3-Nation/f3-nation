/**
 * Validate that a return-to path is safe (relative, no open-redirect).
 * Rejects absolute URLs, protocol-relative URLs, and non-path values.
 */
export function isValidReturnTo(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Sanitize a return-to value, falling back to /domains if invalid. */
export function safeReturnTo(path: string | null | undefined): string {
  if (!path) return "/domains";
  return isValidReturnTo(path) ? path : "/domains";
}
