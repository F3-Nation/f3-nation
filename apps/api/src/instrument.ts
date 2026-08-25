// Preloaded via `tsx --import ./src/instrument.ts` in the dev:hono/start:hono
// scripts (apps/api/package.json), not just imported first in server.ts.
// Native ESM resolves and links the whole module graph before any module body
// evaluates, so by the time server.ts's own `import "~/instrument"` runs,
// `import-in-the-middle`'s hooks can no longer patch libraries (pg, http,
// etc.) that are already in the module map — only registering this ahead of
// module resolution, via --import, lets Sentry's OpenTelemetry
// auto-instrumentation patch them before they're loaded. The in-file import in
// server.ts still runs, but only as a fallback that registers the error
// reporter if the process is ever started without the --import flag.
import * as Sentry from "@sentry/node";

import type { LogContext } from "@acme/logger";
import { setErrorReporter } from "@acme/logger";

import { env } from "~/env";

// logError call sites aren't expected to pass secrets, but this is the last
// line of defense before arbitrary ctx leaves the process as Sentry `extra`
// data — redact anything that looks sensitive by key name rather than trust
// every call site forever.
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|credential|authoriz|cookie|session|api[-_]?key|private/i;

function sanitizeSentryContext(ctx: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(ctx).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  );
}

if (env.NODE_ENV === "production") {
  const channel = env.NEXT_PUBLIC_CHANNEL;
  Sentry.init({
    dsn: "https://7174fea65c117ea4b71977da953bb4d9@o4509266839797760.ingest.us.sentry.io/4509270283714560",

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    environment:
      channel === "prod"
        ? "production"
        : channel === "staging"
          ? "staging"
          : "development",

    // Capture console.error calls and send them to Sentry
    // This ensures caught errors that are logged still get reported
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });

  // Errors logged via @acme/logger's logError go to stdout (pino), not
  // console.error, so captureConsoleIntegration would miss them. Forward them to
  // Sentry explicitly to preserve error alerting as code migrates off console.*.
  // Keep the event name + context so Sentry events stay triageable, and report
  // err-less error logs (config/validation failures) the same way console.error
  // used to.
  setErrorReporter((event, ctx, err) => {
    const extra = sanitizeSentryContext(ctx);
    if (err !== undefined) {
      Sentry.captureException(err, { tags: { event }, extra });
    } else {
      Sentry.captureMessage(event, {
        level: "error",
        tags: { event },
        extra,
      });
    }
  });
}
