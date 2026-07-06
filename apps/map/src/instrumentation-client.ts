// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

function getSentryEnvironment(): string {
  const hostname = window.location.hostname;
  if (hostname === "map.f3nation.com") return "production";
  if (hostname.includes("staging")) return "staging";
  return "development";
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://7174fea65c117ea4b71977da953bb4d9@o4509266839797760.ingest.us.sentry.io/4509270283714560",

    // Add optional integrations for additional features
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    environment: getSentryEnvironment(),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
