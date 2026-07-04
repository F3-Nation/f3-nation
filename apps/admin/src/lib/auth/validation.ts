import { isSafeReturnPath } from "@acme/sso";

/**
 * Validate that a return-to path is safe (relative, no open redirect).
 */
function isValidReturnTo(path: string): boolean {
  return isSafeReturnPath(path);
}

export function safeReturnTo(path: string | null | undefined): string {
  if (!path) return "/";
  return isValidReturnTo(path) ? path : "/";
}
