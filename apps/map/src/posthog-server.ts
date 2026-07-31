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
  // Error volume is tiny and Cloud Run scales to zero between requests —
  // flush every event immediately instead of batching so nothing is lost
  // when an instance is reaped.
  client ??= new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
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
    await posthog.captureExceptionImmediate(error, undefined, {
      environment: env.F3_CHANNEL,
      ...properties,
    });
  } catch {
    // best effort — a failed report is not worth propagating
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
    void captureServerException(err ?? new Error(event), {
      event,
      ...ctx,
    });
  });
}
