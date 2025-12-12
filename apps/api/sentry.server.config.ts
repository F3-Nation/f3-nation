// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { env } from "~/env";

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
  });
}
