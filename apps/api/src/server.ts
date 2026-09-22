import "~/instrument";

import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";

import { app } from "~/app";
import { logError, logInfo } from "~/lib/logging";

// `Number(process.env.PORT)` silently produces 0 (empty string) or NaN
// (non-numeric) for a misconfigured PORT, and @hono/node-server passes either
// straight to Node's net.Server.listen, which binds an arbitrary ephemeral
// port instead of the intended service port. Fail startup loudly instead.
function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 3001;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT env var: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

const port = resolvePort(process.env.PORT);
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
