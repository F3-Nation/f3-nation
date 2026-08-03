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
  const posthog = getPostHogServer();
  if (!posthog) return;
  const error = err instanceof Error ? err : new Error(String(err));
  // Immediate (awaited) send: the queued captureException can be lost when a
  // scale-to-zero Cloud Run instance is reaped before the async flush runs.
  // Swallow transport failures — this is awaited from the request-error
  // instrumentation, and error reporting must never break error handling.
  try {
    // properties spread AFTER environment: a caller-supplied "environment"
    // key must not be able to overwrite the canonical one.
    await posthog.captureExceptionImmediate(error, undefined, {
      ...properties,
      environment: env.F3_CHANNEL,
    });
  } catch (reportErr) {
    // Never propagate — but always leave a trace so a PostHog outage (bad
    // key, network failure, rate limit, TLS error) doesn't look identical to
    // "no errors occurred." This bridge runs decoupled from @acme/logger's
    // own errorReporter try/catch (registerPostHogErrorReporter's callback
    // is synchronous and returns before this awaited call can fail), so
    // without this, nothing records that a report was attempted and failed.
    console.error("posthog.capture_exception_failed", reportErr);
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
