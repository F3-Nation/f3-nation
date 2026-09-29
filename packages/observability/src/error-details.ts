// What an exception report carries beyond the top-level error: the root
// cause, and redaction of query parameters.
//
// Why the root cause matters: every database query goes through Drizzle,
// which wraps any driver error in a DrizzleQueryError whose message is
// `Failed query: <sql>\nparams: <values>`. The real reason (ECONNREFUSED,
// `sorry, too many clients already`, the pool-wait timeout, …) survives only
// on `.cause`, so a report of the top-level error alone says nothing about
// why the query failed — and an alert matching connection-failure messages
// can never fire.

/**
 * Root-cause attributes. There is no OTel semantic convention for an
 * exception's cause, so these extend the `exception.*` namespace.
 */
export const ATTR_EXCEPTION_CAUSE_TYPE = "exception.cause.type";
export const ATTR_EXCEPTION_CAUSE_MESSAGE = "exception.cause.message";
export const ATTR_EXCEPTION_CAUSE_STACKTRACE = "exception.cause.stacktrace";

// Deep enough for any real wrapper stack (Drizzle → postgres.js → Node is 2).
const MAX_CAUSE_DEPTH = 10;

/**
 * The innermost error in `error`'s `.cause` chain, or `undefined` when it
 * has no cause. A non-Error cause ends the walk and is wrapped so callers
 * always get a name and message; an AggregateError with an empty message
 * (Node's multi-address connect failure) descends into its first member.
 * Cycle- and depth-bounded.
 */
export function rootCause(error: Error): Error | undefined {
  const seen = new Set<unknown>([error]);
  let root: Error | undefined;
  let next: unknown = error.cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (next == null || seen.has(next)) break;
    seen.add(next);
    if (!(next instanceof Error)) {
      root = new Error(safeString(next));
      break;
    }
    root = next;
    next =
      next.cause ??
      (next instanceof AggregateError && !next.message
        ? (next.errors as unknown[])[0]
        : undefined);
  }
  return root;
}

const PARAMS_MARKER = "\nparams: ";
const REDACTED_PARAMS = `${PARAMS_MARKER}[redacted]`;

/**
 * Redact the bound values from a Drizzle `Failed query: …\nparams: …`
 * message. The SQL text is parameterized and safe to keep; the params are
 * raw user data (names, emails, free text) and must not leave the process.
 * Everything after the marker is dropped: params can contain anything,
 * including newlines, so there is no safe way to find where they end.
 * Text without that shape is returned unchanged.
 */
export function redactQueryParams(message: string): string {
  if (!message.startsWith("Failed query: ")) return message;
  const start = message.indexOf(PARAMS_MARKER);
  return start < 0 ? message : message.slice(0, start) + REDACTED_PARAMS;
}

/**
 * The stack with `message`'s params redacted, or `undefined` when that
 * can't be done safely. A stack's header embeds the message verbatim, so
 * the raw message is located exactly and swapped for the redacted one —
 * never by guessing where the params end (a bound value can itself contain
 * a line that looks like `    at …`). If the raw message isn't found in the
 * stack, the stack is dropped rather than risk sending the params.
 */
export function redactStack(
  stack: string | undefined,
  message: string,
): string | undefined {
  if (!stack) return undefined;
  const redacted = redactQueryParams(message);
  if (redacted === message) return stack;
  const at = stack.indexOf(message);
  if (at < 0) return undefined;
  return stack.slice(0, at) + redacted + stack.slice(at + message.length);
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable error value]";
  }
}
