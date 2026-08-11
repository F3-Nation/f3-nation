// This file configures the initialization of PostHog on the client (error
// tracking + product analytics). It runs whenever a user loads a page in
// their browser. Everything is a silent no-op when no key is configured.
// https://posthog.com/docs/libraries/next-js

import posthog from "posthog-js";

import { env } from "~/env";

if (env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: "https://us.i.posthog.com",

    // PostHog's current recommended Next.js setup. Without this, capture_pageview
    // falls back to its legacy default (true), which only fires a pageview on
    // the initial page load — in an App Router app, every subsequent
    // client-side route transition would produce no pageview event at all.
    // "2025-05-24" switches capture_pageview to "history_change", which
    // correctly fires on client-side navigations too.
    defaults: "2025-05-24",

    // Error tracking: autocapture unhandled exceptions / unhandled promise
    // rejections as $exception events.
    capture_exceptions: true,

    // Privacy: never send raw on-page text with autocaptured events.
    mask_all_text: true,

    // Session recording is opt-in via env flag — previews/sandbox must never
    // record. When enabled, inputs stay masked. `mask_all_text` above only
    // governs autocapture — replay has its own separate masking config, so
    // maskTextSelector is required too or rendered page text (names, emails)
    // would be stored unmasked in the recording.
    disable_session_recording:
      env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING !== "true",
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
  });
}
