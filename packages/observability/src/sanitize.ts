// Redaction for logger-bridged error context.
//
// logError call sites aren't expected to pass secrets, but this is the last
// line of defense before arbitrary ctx leaves the process as error-tracker
// attributes — redact anything that looks sensitive by key name rather than
// trust every call site forever.
//
// This arrived with the Hono server's Sentry bridge (apps/api/src/instrument.ts)
// and moved here during the OTel migration so every app's logger bridge gets
// it, not just the one entrypoint that happened to define it.

import type { LogContext } from "@acme/logger";

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|credential|authoriz|cookie|session|api[-_]?key|private/i;

// Recurses into nested objects/arrays so a shape like
// `{ request: { headers: { authorization } } }` gets redacted too, not just
// top-level keys. `seen` guards against circular references.
function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, seen));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? "[redacted]"
          : sanitizeValue(val, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

/** Redact sensitive-looking keys anywhere in a log context, recursively. */
export function sanitizeLogContext(ctx: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(ctx).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? "[redacted]"
        : sanitizeValue(value, new WeakSet()),
    ]),
  );
}
