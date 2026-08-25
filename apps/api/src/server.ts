import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";

import { setErrorReporter } from "@acme/logger";

import { app } from "~/app";
import { env } from "~/env";
import { logError } from "~/lib/logging";

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
    if (err !== undefined) {
      Sentry.captureException(err, { tags: { event }, extra: ctx });
    } else {
      Sentry.captureMessage(event, {
        level: "error",
        tags: { event },
        extra: ctx,
      });
    }
  });
}

// Equivalent of Next's `onRequestError` instrumentation hook: the last-resort
// catch for anything that throws out of a handler unhandled.
app.onError((err, c) => {
  Sentry.captureException(err);
  return c.text("Internal Server Error", 500);
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port });

// Cloud Run sends SIGTERM with a ~10s grace window before SIGKILL.
process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      logError("api.server.shutdown_error", {}, err);
      process.exit(1);
    }
    process.exit(0);
  });
});
