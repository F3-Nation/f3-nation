// Preloaded via `tsx --import ./src/instrument.ts` in the dev:hono/start:hono
// scripts (apps/api/package.json), not just imported first in server.ts.
// Native ESM resolves and links the whole module graph before any module body
// evaluates, so by the time server.ts's own `import "~/instrument"` runs,
// `import-in-the-middle`'s hooks can no longer patch libraries (pg, http,
// etc.) that are already in the module map — only registering this ahead of
// module resolution, via --import, lets auto-instrumentation patch them
// before they're loaded. The in-file import in server.ts still runs, but only
// as a fallback that registers the error reporter if the process is ever
// started without the --import flag.
//
// This is the Hono server's entrypoint into the same OTel pipeline that
// Next's instrumentation.ts registers for the API app — see
// @acme/observability. Context redaction now lives in that package's logger
// bridge, so it applies to every app rather than only this file.
import {
  registerLoggerErrorReporter,
  registerObservability,
} from "@acme/observability";

import { env } from "~/env";
import { logWarn } from "~/lib/logging";

if (env.NODE_ENV === "production") {
  registerObservability({
    serviceName: "api",
    environment: env.NEXT_PUBLIC_CHANNEL,
    posthog: { apiKey: env.NEXT_PUBLIC_POSTHOG_KEY },
  });
  registerLoggerErrorReporter();
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    logWarn("api.observability.posthog_disabled", {
      channel: env.NEXT_PUBLIC_CHANNEL,
    });
  }
}
