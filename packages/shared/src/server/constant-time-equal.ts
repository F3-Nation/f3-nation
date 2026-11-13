import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) =>
  createHash("sha256").update(value, "utf8").digest();

/**
 * Compare two secrets without leaking content or length through timing. Both
 * sides are hashed to a fixed length before the constant-time compare. Empty
 * or missing input on either side is never equal, so an unset secret fails
 * closed.
 */
export function constantTimeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length === 0 ||
    b.length === 0
  ) {
    return false;
  }
  return timingSafeEqual(digest(a), digest(b));
}
