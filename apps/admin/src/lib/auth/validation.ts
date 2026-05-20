/**
 * Validate that a return-to path is safe (relative, no open redirect).
 */
export function isValidReturnTo(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (/[\\\r\n\t]/.test(path)) return false;
  return true;
}

export function safeReturnTo(path: string | null | undefined): string {
  if (!path) return "/";
  return isValidReturnTo(path) ? path : "/";
}
