import { sanitizeReturnPath } from "@acme/sso";

export function safeReturnTo(path: string | null | undefined): string {
  return sanitizeReturnPath(path, "/");
}
