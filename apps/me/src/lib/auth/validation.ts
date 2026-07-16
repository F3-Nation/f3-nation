import { isSafeReturnPath, sanitizeReturnPath } from "@f3nation/sso";

/**
 * Validate that a return-to path is safe (relative, no open-redirect).
 * Rejects absolute URLs, protocol-relative URLs, and non-path values.
 */
export function isValidReturnTo(path: string): boolean {
  return isSafeReturnPath(path);
}

/** Sanitize a return-to value, falling back to /profile if invalid. */
export function safeReturnTo(path: string | null | undefined): string {
  return sanitizeReturnPath(path, "/profile");
}
