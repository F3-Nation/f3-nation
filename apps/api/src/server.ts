import "~/instrument";

import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";

import { app } from "~/app";
import { logError, logInfo } from "~/lib/logging";

// Equivalent of Next's `onRequestError` instrumentation hook: the last-resort
// catch for anything that throws out of a handler unhandled.
app.onError((err, c) => {
  logError(
    "api.app.unhandled_error",
    { path: c.req.path, method: c.req.method },
    err,
  );
  return c.text("Internal Server Error", 500);
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port });

// Cloud Run sends SIGTERM with a ~10s grace window before SIGKILL — force-exit
// a couple seconds ahead of that so a hung close() reports its own error
// instead of dying silently to a Cloud Run SIGKILL.
let shuttingDown = false;
process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("api.server.shutdown_initiated", {});

  const forceExit = setTimeout(() => {
    logError("api.server.shutdown_timeout", {});
    process.exit(1);
  }, 8000).unref();

  server.close((err) => {
    clearTimeout(forceExit);
    void Sentry.flush(2000)
      .catch(() => undefined)
      .finally(() => {
        if (err) {
          logError("api.server.shutdown_error", {}, err);
          process.exit(1);
        }
        process.exit(0);
      });
  });
});
