// Server-side PostHog client (error tracking). Created lazily and only when a
// key is configured — every capture below is a silent no-op without one.
// https://posthog.com/docs/error-tracking/installation

import { PostHog } from "posthog-node";

import type { LogContext } from "@acme/logger";
import { setErrorReporter } from "@acme/logger";

import { env } from "~/env";

let client: PostHog | undefined;

function getPostHogServer(): PostHog | undefined {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return undefined;
  // Error volume is tiny and Cloud Run scales to zero between requests. Note
  // flushAt/flushInterval only govern posthog-node's batched capture()/
  // captureException() path — the only method this file calls is
  // captureExceptionImmediate below, which sends over HTTP directly and
  // never consults these two options. The actual "nothing is lost when an
  // instance is reaped" guarantee comes entirely from using
  // captureExceptionImmediate; these are left as a defensive fallback in
  // case a future edit adds a non-immediate capture() call here.
  client ??= new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    // This is awaited synchronously from request-error instrumentation — a
    // PostHog outage or slow network must not degrade error handling. The
    // SDK's defaults (10s timeout, 3 retries) could otherwise block for
    // 30+s; bound it tightly and skip retries (this is a fire-once error
    // report, not data that must land — a failure is already logged by the
    // catch below).
    requestTimeout: 3000,
    fetchRetryCount: 0,
  });
  return client;
}

/**
 * Capture a server-side error as a PostHog `$exception` event. Non-`Error`
 * values are wrapped so PostHog error tracking always gets a real stack.
 */
export async function captureServerException(
  err: unknown,
  properties?: Record<string, unknown>,
): Promise<void> {
  // The whole body is inside this try, not just the awaited send: this is an
  // async function, so a synchronous throw from getPostHogServer() or
  // String(err) (a non-Error value with a throwing toString/
  // Symbol.toPrimitive) wouldn't throw synchronously out of this call — it
  // would become a rejected Promise. registerPostHogErrorReporter below
  // calls this with `void`, so an unhandled rejection would crash the
  // process (Node terminates on one by default since v15).
  try {
    const posthog = getPostHogServer();
    if (!posthog) return;
    const error = err instanceof Error ? err : new Error(safeStringify(err));
    // Immediate (awaited) send: the queued captureException can be lost when a
    // scale-to-zero Cloud Run instance is reaped before the async flush runs.
    // properties spread AFTER environment: a caller-supplied "environment"
    // key must not be able to overwrite the canonical one.
    await posthog.captureExceptionImmediate(error, undefined, {
      ...properties,
      environment: env.F3_CHANNEL,
    });
  } catch (reportErr) {
    // Never propagate — but always leave a trace so a PostHog outage (bad
    // key, network failure, rate limit, TLS error) doesn't look identical to
    // "no errors occurred." Deliberately console.error, not logError: this
    // file's registerPostHogErrorReporter IS the app's errorReporter, so
    // logError here would re-enter it via packages/logger/src/index.ts's
    // reportable(). The raw pino `logger` isn't an option either — this
    // repo's own no-restricted-syntax ESLint rule reserves it for
    // packages/logger itself (see its eslint.config.js override), which
    // needs the exact same escape hatch for the exact same reason.
    console.error("posthog.capture_exception_failed", reportErr);
  }
}

function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable error value]";
  }
}

/**
 * Bridge @acme/logger's `logError`/`logFatal` into PostHog so structured
 * error logs (pino → stdout) still reach an alertable error tracker. Keeps
 * the event name + context so events stay triageable, and reports err-less
 * error logs (config/validation failures) as synthetic errors named after
 * the event — the same coverage the old console.error path had.
 */
export function registerPostHogErrorReporter() {
  setErrorReporter((event: string, ctx: LogContext, err?: unknown) => {
    // logError/logFatal are synchronous, so this bridge can't await; fire and
    // forget. captureServerException swallows its own failures, so there is no
    // rejection to handle here.
    // ctx spread AFTER event: a ctx key named "event" must not be able to
    // overwrite the canonical event identifier used for PostHog triage.
    void captureServerException(err ?? new Error(event), {
      ...ctx,
      event,
    });
  });
}
