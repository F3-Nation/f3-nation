// This file configures the initialization of PostHog on the client (error
// tracking + product analytics). It runs whenever a user loads a page in
// their browser. Everything is a silent no-op when no key is configured.
// https://posthog.com/docs/libraries/next-js

import posthog from "posthog-js";

import { env } from "~/env";

if (env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: "https://us.i.posthog.com",

    // Error tracking: autocapture unhandled exceptions / unhandled promise
    // rejections as $exception events.
    capture_exceptions: true,

    // Privacy: never send raw on-page text with autocaptured events.
    mask_all_text: true,

    // Session recording is opt-in via env flag — previews/sandbox must never
    // record. When enabled, inputs stay masked (the update-request form
    // carries names and emails).
    disable_session_recording:
      env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING !== "true",
    session_recording: {
      maskAllInputs: true,
    },
  });
}
